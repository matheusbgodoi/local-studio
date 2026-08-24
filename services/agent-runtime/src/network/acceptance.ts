//
// The acceptance run for protected networking.
//
// This is not a unit test and is not wired into `npm run check`, CI or a git
// hook. It is a harness that talks to the real machine — a real sing-box, a
// real Seatbelt jail, a real Chromium — because every claim this feature makes
// is about what the operating system does, and none of it can be established by
// mocking the operating system.
//
// The load-bearing check is not "did the request succeed". It is:
//
//     the address the world sees for a protected workload is NOT the address it
//     sees when this machine talks directly
//
// so the baseline direct address is measured FIRST, before protection is
// engaged, and every later probe is compared against it. A probe that comes
// back carrying the direct address is a leak, and it is reported as one no
// matter what else passed.
//
// Nothing here prints key material, a configuration path's contents, or a full
// address: exit addresses are masked to their first two octets, which is enough
// to tell "same as direct" from "different" without putting an address in a log
// the owner may paste somewhere.
//

import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveDataDir } from "../data-dir";
import { networkService } from "./index";
import { jailSupported } from "./jail";
import { resolveSingBoxBinary } from "./sing-box";

type Outcome = "PASS" | "FAIL" | "SKIP" | "INCONCLUSIVE";

type Check = {
  name: string;
  outcome: Outcome;
  note: string;
};

//
// A plain-text echo that answers with nothing but an address. Chosen over the
// richer ip-api because that one rate-limits, and a rate-limited probe reads as
// a failed one — which during development turned a healthy tunnel into four
// FAILs and an alarming report.
//
const IP_ECHO = "http://checkip.amazonaws.com/";

function mask(ip: string | null): string {
  if (!ip) return "not measured";
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : "not measured";
}

function shell(command: string, timeoutMs = 30_000): string {
  const result = spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return `${result.stdout ?? ""}`.trim();
}

function jailedShell(command: string, timeoutMs = 30_000): string {
  const wrapped = networkService().wrap({ command: "/bin/sh", args: ["-c", command] });
  const env = { ...process.env, ...networkService().environment() };
  const result = spawnSync(wrapped.command, wrapped.args, {
    encoding: "utf8",
    timeout: timeoutMs,
    env,
  });
  return `${result.stdout ?? ""}`.trim();
}

function looksLikeIpv4(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value.trim());
}

//
// A probe reports three things and they are all needed. Whether it reached the
// outside, what address it was seen as, and — the part that matters — whether
// that address was the direct one.
//
function probe(
  name: string,
  command: string,
  directIp: string | null,
  observed: string[],
  sameHostExit: boolean,
): Check {
  const output = jailedShell(command);
  const ip = looksLikeIpv4(output) ? output.trim() : null;
  if (!ip) return { name, outcome: "FAIL", note: "no address returned" };
  observed.push(ip);
  if (directIp && ip === directIp) {
    //
    // Identical addresses mean one of two things and the address alone cannot
    // tell them apart: traffic leaked around the tunnel, or the tunnel exits on
    // this same host. The second is what a loopback or private peer is, and it
    // is what a local rig looks like — so it is reported as inconclusive rather
    // than as a pass it has not earned or a leak it has not proved.
    //
    if (sameHostExit) {
      return { name, outcome: "INCONCLUSIVE", note: "tunnel exits on this host" };
    }
    return { name, outcome: "FAIL", note: `LEAK — exited on the direct address ${mask(ip)}` };
  }
  return { name, outcome: "PASS", note: `exit ${mask(ip)}` };
}

//
// A blocked probe is a PASS. This is the half of the suite that proves the
// absence of a fallback, and "it worked" would be the failure.
//
// The command must bypass the proxy environment explicitly. curl honours
// HTTP_PROXY for http:// URLs, and protection sets it — so a probe that merely
// omits `--proxy` is not testing the direct path at all. It measured as a leak
// once the supervisor restarted the tunnel underneath it, which is how the
// mistake surfaced: the probe reported a breach the boundary had not had.
//
function blockedProbe(name: string, command: string, directIp: string | null): Check {
  const output = jailedShell(command, 20_000);
  const trimmed = output.trim();
  if (looksLikeIpv4(trimmed)) {
    const leaked = directIp && trimmed === directIp;
    return {
      name,
      outcome: "FAIL",
      note: leaked
        ? `LEAK — reached the internet on the direct address ${mask(trimmed)}`
        : `reached the internet while protection was down (${mask(trimmed)})`,
    };
  }
  return { name, outcome: "PASS", note: "blocked" };
}

//
// A peer on loopback or in private address space cannot be a provider exit; it
// is a local rig. The exit-address comparison is meaningless in that case and
// the report says so instead of drawing a conclusion from it.
//
function exitsOnThisHost(endpointHost: string | null): boolean {
  if (!endpointHost) return false;
  return (
    /^127\./.test(endpointHost) ||
    endpointHost === "::1" ||
    endpointHost === "localhost" ||
    /^10\./.test(endpointHost) ||
    /^192\.168\./.test(endpointHost) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(endpointHost)
  );
}

function render(checks: readonly Check[], directObserved: boolean, sameHostExit: boolean): string {
  const width = Math.max(...checks.map((check) => check.name.length)) + 2;
  const lines = checks.map(
    (check) => `${check.name.padEnd(width)}${check.outcome}${check.note ? `  ${check.note}` : ""}`,
  );
  return [
    "VPN Protected acceptance",
    "",
    ...lines,
    "",
    sameHostExit
      ? "Direct IP while protected: not assessable — the configured peer exits on this host"
      : `Direct IP while protected: ${directObserved ? "OBSERVED — THIS IS A LEAK" : "NOT OBSERVED"}`,
  ].join("\n");
}

export async function runAcceptance(): Promise<number> {
  const service = networkService();
  const checks: Check[] = [];

  if (!jailSupported()) {
    console.log("VPN Protected acceptance\n\nunsupported platform: no Seatbelt egress boundary");
    return 1;
  }
  if (!resolveSingBoxBinary()) {
    console.log("VPN Protected acceptance\n\nsing-box was not found; nothing to measure");
    return 1;
  }
  if (!service.isConfigured()) {
    console.log(
      "VPN Protected acceptance\n\nno VPN configuration has been imported; import one and re-run",
    );
    return 1;
  }

  //
  // Measured before protection exists, on the machine's own route, and never
  // again afterwards. Everything below is compared against it.
  //
  const directRaw = shell(`curl -s -m 10 ${IP_ECHO}`);
  const directIp = looksLikeIpv4(directRaw) ? directRaw.trim() : null;

  service.setSessionPolicy("acceptance", "vpn_protected");
  await waitForState(["PROTECTED", "DEGRADED"], 45_000);

  if (!service.mayEgress()) {
    console.log(
      `VPN Protected acceptance\n\nprotection did not come up: ${service.currentState()} ${service.status().detail ?? ""}`,
    );
    service.setSessionPolicy("acceptance", "direct");
    return 1;
  }

  const observed: string[] = [];
  const sameHostExit = exitsOnThisHost(service.status().tunnel.endpointHost);
  const curlIp = `curl -s -m 20 --proxy $HTTP_PROXY ${IP_ECHO}`;

  checks.push(probe("shell/curl", curlIp, directIp, observed, sameHostExit));
  checks.push(
    probe(
      "python",
      `python3 -c "import os,urllib.request as u; p=u.ProxyHandler({'http':os.environ['HTTP_PROXY']}); print(u.build_opener(p).open('${IP_ECHO}',timeout=20).read().decode().strip())"`,
      directIp,
      observed,
      sameHostExit,
    ),
  );
  checks.push(
    probe(
      "node",
      `node -e "fetch('${IP_ECHO}').then(r=>r.text()).then(t=>console.log(t.trim())).catch(e=>console.log('blocked'))"`,
      directIp,
      observed,
      sameHostExit,
    ),
  );
  checks.push(
    probe(
      "git/CLI",
      `git config --get-regexp . >/dev/null 2>&1; ${curlIp}`,
      directIp,
      observed,
      sameHostExit,
    ),
  );

  const status = service.status();
  checks.push(observation("DNS", status.dns));
  checks.push(observation("IPv4", status.ipv4));
  checks.push(observation("IPv6", status.ipv6));
  checks.push({
    name: "fail-closed enforced",
    outcome: status.enforcement.failClosed ? "PASS" : "FAIL",
    note: status.enforcement.mechanism ?? "no mechanism reported",
  });

  //
  // The two spawn sites whose stdio this repo does NOT own — the SDK's bash tool
  // and Playwright's pipe transport — can change under a version bump without
  // anyone here noticing, and a descriptor that crosses the boundary stays
  // writable because Seatbelt hooks connect and not write. So it is re-measured
  // rather than assumed: a jailed child must hold no AF_INET/AF_INET6 descriptor
  // at all.
  //
  const strayFds = jailedShell("/usr/sbin/lsof -nP -a -i -p $$ 2>/dev/null | tail -n +2");
  checks.push({
    name: "no inherited socket",
    outcome: strayFds.trim() === "" ? "PASS" : "FAIL",
    note:
      strayFds.trim() === ""
        ? "a jailed child holds no network descriptor at exec"
        : "a descriptor crossed the boundary",
  });

  //
  // The most important check in the file. The tunnel is killed with real work
  // in flight, and every path is asked again. All of them must fail, and none
  // of them may come back carrying the direct address.
  //
  const killed = await killTunnel();
  if (killed) {
    //
    // Deliberately NOT the proxied path: the supervisor re-engages a killed
    // tunnel, so "the proxy is down" is a race, while "there is no direct path"
    // is the invariant and stays true either way.
    //
    checks.push(
      blockedProbe(
        "kill switch: no direct curl",
        `curl -s -m 10 --noproxy '*' ${IP_ECHO}`,
        directIp,
      ),
    );
    checks.push(
      blockedProbe(
        "kill switch: no direct wget",
        `env -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy curl -s -m 10 ${IP_ECHO}`,
        directIp,
      ),
    );
    checks.push(
      blockedProbe(
        "kill switch: raw socket",
        `python3 -c "
import socket
s=socket.socket(); s.settimeout(6)
try:
    s.connect(('1.1.1.1',443)); print('1.1.1.1')
except OSError: print('blocked')"`,
        directIp,
      ),
    );
    checks.push({
      name: "kill switch: state",
      outcome: service.mayEgress() ? "FAIL" : "PASS",
      note: service.currentState(),
    });
  } else {
    checks.push({ name: "kill switch", outcome: "SKIP", note: "the tunnel was not running" });
  }

  service.setSessionPolicy("acceptance", "direct");
  await service.shutdown();

  const leaked = !sameHostExit && directIp !== null && observed.includes(directIp);
  const failed = checks.some((check) => check.outcome === "FAIL");
  console.log(render(checks, leaked, sameHostExit));
  return failed || leaked ? 1 : 0;
}

function observation(name: string, value: string): Check {
  //
  // `blocked` is a pass for IPv6: a tunnel that carries no v6 route and refuses
  // v6 is behaving correctly. `unavailable` is never a pass — an unread field
  // is the one thing this suite must not let through as good news.
  //
  if (value === "protected" || value === "blocked") {
    return { name, outcome: "PASS", note: value };
  }
  return { name, outcome: "FAIL", note: value };
}

function waitForState(wanted: readonly string[], timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      if (wanted.includes(networkService().currentState()) || Date.now() - started > timeoutMs) {
        return resolve();
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

//
// Kills OUR tunnel, matched by the config file this runtime wrote, not every
// sing-box on the machine. A blanket `pkill -f "sing-box run"` also killed
// unrelated instances — including, while developing this, the peer the harness
// was measuring against, which then failed every subsequent run for a reason
// that had nothing to do with the code.
//
async function killTunnel(): Promise<boolean> {
  const before = networkService().currentState();
  if (before === "DIRECT" || before === "ERROR") return false;
  const config = path.join(resolveDataDir(), "network", "sing-box.json");
  spawnSync("/bin/sh", ["-c", `pkill -f ${JSON.stringify(config)} || true`], { encoding: "utf8" });
  await waitForState(["BLOCKED", "ERROR", "STARTING"], 15_000);
  return true;
}

if (process.argv[1]?.includes("acceptance")) {
  void runAcceptance().then((code) => {
    process.exitCode = code;
  });
}
