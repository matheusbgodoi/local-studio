//
// THE EGRESS BOUNDARY.
//
// This file is the security-critical one. Everything else in `network/` either
// decides whether the boundary should exist or reports on what is behind it;
// this is the thing that actually makes escaping it impossible.
//
// The mechanism is the macOS Seatbelt sandbox, applied per process with
// sandbox-exec. A jailed process is allowed exactly one network destination —
// the loopback port sing-box is listening on — and nothing else. Four
// properties are why this was chosen over the alternatives:
//
//   1. It is INHERITED. Every child, grandchild and exec'd binary is bound by
//      it, so wrapping the shell wraps curl, python, node, git, npm and
//      anything else the model decides to run.
//   2. It CANNOT BE WIDENED from inside. A nested sandbox-exec with a
//      permissive profile fails with "sandbox_apply: Operation not permitted".
//      A jailed process cannot argue its way out.
//   3. It needs NO PRIVILEGE. No root, no pf, no TUN device, no installed
//      daemon, no entitlement.
//   4. Losing the tunnel is FAIL-CLOSED BY CONSTRUCTION, not by rule. The only
//      permitted destination is the proxy; if the proxy is gone there is no
//      second path to fall back to, because none was ever allowed.
//
// Two alternatives were measured and rejected on this machine:
//
//   - sing-box TUN with auto_route needs root, and any process can escape a
//     routing table with setsockopt(IP_BOUND_IF) — which succeeded as an
//     ordinary user on every interface. strict_route, which mitigates it, is
//     Linux/Windows only.
//   - pf with a `group` rule is kernel-enforced and does cover IPv6, but
//     pf_socket_lookup only resolves credentials for TCP and UDP, so the rule
//     is structurally blind to ICMP; and because pf matches the ids stored at
//     socket creation, setuid binaries (traceroute is setuid root and
//     world-executable) create sockets it cannot see.
//
// What this boundary does NOT cover is stated in unconfinedPaths() and is
// surfaced to the owner rather than hidden: a jailed process cannot open a new
// connection, but Seatbelt hooks connect/sendto/bind rather than write(), so a
// socket that was already connected elsewhere and handed in as a file
// descriptor stays writable. That needs a cooperating unjailed helper to
// exist; the runtime does not pass descriptors into jailed children, which is
// what keeps it theoretical here.
//

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const JAIL_MECHANISM = "macos-seatbelt";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export type JailOptions = {
  proxyPort: number;
  profileDirectory: string;
  writableRoots: readonly string[];
};

export type JailedCommand = {
  command: string;
  args: string[];
};

export function jailSupported(): boolean {
  return process.platform === "darwin" && existsSync(SANDBOX_EXEC);
}

//
// `remote ip` in a Seatbelt profile accepts only `*` or `localhost` as a host —
// a literal address or a CIDR is rejected at parse time — but the port is
// honoured, and a port is all that is needed here. Pinning the exact port
// matters: allowing `localhost:*` would re-open every listener on the machine,
// several of which (an ssh -D tunnel, a debugger port, a dev server) would
// happily forward outbound for the jailed process.
//
// The file-write denial is not incidental. With `(allow default)` alone a
// jailed process still has the owner's filesystem rights, so it could write a
// LaunchAgent or edit a shell profile and get itself executed unjailed on the
// next login — an escape that goes around the network rule rather than through
// it.
//
export function buildProfile(options: JailOptions): string {
  const writable = options.writableRoots
    .filter((root) => root.trim().length > 0)
    .map((root) => `  (subpath ${JSON.stringify(path.resolve(root))})`)
    .join("\n");

  return `(version 1)
(allow default)

(deny network*)
(allow network-outbound (remote ip "localhost:${options.proxyPort}"))
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))

(deny file-write*)
(allow file-write*
${writable}
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "/dev")
)
`;
}

export function writeProfile(options: JailOptions): string {
  mkdirSync(options.profileDirectory, { recursive: true, mode: 0o700 });
  const filepath = path.join(options.profileDirectory, `egress-${options.proxyPort}.sb`);
  writeFileSync(filepath, buildProfile(options), { mode: 0o600 });
  return filepath;
}

//
// Wrap a command so it runs inside the jail. The wrapped form is exec'd
// directly rather than through a shell so nothing in the original argv can be
// re-interpreted on the way in.
//
export function jailCommand(profilePath: string, command: JailedCommand): JailedCommand {
  return {
    command: SANDBOX_EXEC,
    args: ["-f", profilePath, command.command, ...command.args],
  };
}

//
// The environment a jailed process should see. These variables are NOT the
// boundary — a process is free to ignore every one of them and it simply gets
// EPERM instead of a connection. They exist so that well-behaved tools take the
// one permitted path without needing to be told, which is the difference
// between "protected mode works" and "protected mode blocks everything".
//
// getaddrinfo is dead inside the jail by design, so every value here resolves
// names at the proxy rather than locally: `socks5h` and `HTTPS_PROXY` via
// CONNECT both do. NO_PROXY carries loopback so a tool talking to the runtime's
// own HTTP surface does not bounce off the proxy.
//
export function jailEnvironment(proxyPort: number): Record<string, string> {
  const http = `http://127.0.0.1:${proxyPort}`;
  const socks = `socks5h://127.0.0.1:${proxyPort}`;
  return {
    HTTP_PROXY: http,
    HTTPS_PROXY: http,
    http_proxy: http,
    https_proxy: http,
    ALL_PROXY: socks,
    all_proxy: socks,
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
    LOCAL_STUDIO_NETWORK_POLICY: "vpn_protected",
    LOCAL_STUDIO_EGRESS_PROXY: http,
  };
}

//
// Chromium runs its own Seatbelt sandbox, and a nested sandbox_apply inside our
// jail fails — its GPU and renderer children crash on startup. Running it with
// --no-sandbox is therefore required to keep the browser working under
// protection, and that is a real trade: it removes Chromium's own defence
// against hostile page content while keeping the egress boundary.
//
// --proxy-server is what makes the browser usable rather than merely contained:
// Chromium ignores HTTP_PROXY entirely and reads either the system network
// settings or this flag. Measured on this machine: jailed with the flag,
// example.com returns its full 560-byte DOM; jailed without it, the same run
// returns an empty 39-byte document. That is the fail-closed outcome, and it is
// what the acceptance run asserts. A socks5:// proxy resolves names at the
// proxy, so no separate DNS flag is needed — getaddrinfo is already denied
// inside the jail.
//
export function chromiumJailArguments(proxyPort: number): string[] {
  return [
    "--no-sandbox",
    `--proxy-server=socks5://127.0.0.1:${proxyPort}`,
    "--proxy-bypass-list=<-loopback>",
  ];
}

//
// Named honestly, and rendered in the UI. A path listed here is one this
// boundary is known not to cover, and its presence is what keeps the status
// from claiming more than was built.
//
export function unconfinedPaths(inProcessRouted: boolean): string[] {
  const paths: string[] = [];
  if (!inProcessRouted) {
    paths.push(
      "agent-runtime in-process HTTP (search, reader, connectors) is not jailed; it is routed in code",
    );
  }
  paths.push("a socket connected before the jail and passed in as a descriptor stays writable");
  return paths;
}
