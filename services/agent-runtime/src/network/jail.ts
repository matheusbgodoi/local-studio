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
import { homedir } from "node:os";
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

//
// Single-quoted for /bin/sh, not JSON-quoted. JSON.stringify produces double
// quotes, and inside those a shell still expands $ and backticks — so a data
// directory containing either (it comes from LOCAL_STUDIO_DATA_DIR, which the
// environment controls) would be interpreted rather than passed through. Single
// quotes suppress every expansion, and the only character that needs handling
// is the quote itself.
//
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function jailSupported(): boolean {
  return process.platform === "darwin" && existsSync(SANDBOX_EXEC);
}

//
// `deny network*` denies UNIX-DOMAIN sockets as well as IP ones, which is a
// trap: Chrome's ProcessSingleton binds a unix socket in TMPDIR before it does
// anything else, so the full Chromium — which is what
// `chromium.executablePath()` actually resolves to here — aborted at startup
// under protection, and the per-pid profile fallback failed the same way. A
// unix socket is not a route to anywhere; it has no address family that can
// leave the machine. Allowing it costs nothing at the boundary, and IP egress
// was re-measured unchanged either side of the change.
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
// THE LAST RULE IS THE ONE THAT MATTERS. Seatbelt is last-match-wins, and the
// profile itself and both exec shims live inside the data directory the jail
// makes writable. Without a trailing deny a jailed process could simply
// overwrite `egress-<port>.sb` with `(allow default)` and wait: the process
// that applies the profile is the UNJAILED parent, and sandbox-exec re-reads it
// from disk on every spawn, so the very next tool call would run with no
// boundary at all while the status still read PROTECTED. That is not a nested
// sandbox_apply — which the kernel refuses — it is editing the rules before
// they are applied, and it defeats the whole design. An adversarial review
// found it and reproduced it end to end.
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
(allow network-bind (local unix-socket))
(allow network-outbound (remote unix-socket))
(allow network-inbound (local unix-socket))

(deny file-write*)
(allow file-write*
${writable}
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "/dev")
)
(deny file-write* (subpath ${JSON.stringify(path.resolve(options.profileDirectory))}))
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
// The only stdio shape a protected child may be given.
//
// Seatbelt hooks connect/sendto/bind, not write(), so a socket that was already
// connected before the jail existed stays writable from inside it. There are
// exactly two ways such a descriptor can cross a spawn: the string "inherit",
// which hands the child the RUNTIME's own descriptor, and a number, which hands
// it that exact fd. "pipe" and "ignore" cannot — they always produce a fresh
// socketpair or /dev/null.
//
// This is asserted rather than assumed because the property currently rests on
// third-party defaults. The MCP SDK's own default is
// `stdio: ['pipe','pipe', stderr ?? 'inherit']`, and an audit reproduced the
// leak end to end: with the runtime's stderr connected to a socket, a jailed
// connector received it as fd 2 and wrote through it, while a fresh connect()
// from the same process returned EPERM. One deleted keyword was the whole
// distance between "documented limitation" and "realised leak".
//
export const PROTECTED_STDIO = ["pipe", "pipe", "pipe"] as const;

export function assertNoInheritedDescriptors(stdio: readonly unknown[]): void {
  if (stdio.length > 3) {
    throw new Error("a protected child was given a descriptor above fd 2; refusing to start it");
  }
  for (const slot of stdio) {
    if (slot !== "pipe" && slot !== "ignore") {
      throw new Error(
        `a protected child may only be given "pipe" or "ignore" stdio; got ${String(slot)}`,
      );
    }
  }
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
    //
    // Node's fetch ignores HTTP_PROXY unless this is set. Measured: without it
    // a jailed `node -e fetch(...)` fails with ENOTFOUND; with it the same call
    // returns 200 through the tunnel. It changes whether protected mode is
    // usable from Node, not whether it is safe — the jail is what makes it safe.
    //
    NODE_USE_ENV_PROXY: "1",
    LOCAL_STUDIO_NETWORK_POLICY: "vpn_protected",
    LOCAL_STUDIO_EGRESS_PROXY: http,
  };
}

//
// Chromium runs unsandboxed here, and protection is NOT what causes that.
//
// playwright-core appends --no-sandbox whenever `chromiumSandbox !== true`, and
// browser-host/playwright.ts has never set it — so Direct mode runs an
// unsandboxed Chromium too. This flag is a duplicate of Playwright's own, kept
// because it states the intent at the point it matters.
//
// What protection DOES add is that the choice cannot be reversed while jailed.
// Chromium re-applies a Seatbelt profile to each child, and the kernel refuses
// any second profile whose compiled blob differs from the one already applied —
// measured directly against libsandbox: compile succeeds inside our jail,
// sandbox_apply returns EPERM, and a byte-identical re-apply returns 0 as a
// no-op. It is a kernel refusal to nest, not a missing rule, so no allow can
// widen it and no Chromium flag recovers a real renderer sandbox: --single-process
// boots but puts page JS in the browser process, which is less isolation.
//
// The proxy itself is set through Playwright's own `proxy` option, which emits
// --proxy-server for us; only --no-sandbox has to be added by hand. Chromium
// ignores HTTP_PROXY entirely, so without that option a jailed browser reaches
// nothing: measured, it returns ERR_NAME_NOT_RESOLVED. A socks5 proxy resolves
// names at the far end, so no DNS flag is needed either — getaddrinfo is already
// denied inside the jail.
//
export function chromiumJailArguments(): string[] {
  return ["--no-sandbox"];
}

//
// Playwright spawns Chromium itself, from `executablePath`, so there is no argv
// for jailCommand() to wrap. Pointing executablePath at a tiny exec shim is what
// puts the browser inside the same boundary as everything else: Playwright
// spawns the shim, the shim execs sandbox-exec, and sandbox-exec execs the real
// binary. exec replaces the process rather than forking, so the debugging pipe
// Playwright talks to on fd 3 and 4 survives untouched.
//
// Measured: a Playwright-driven Chromium behind this shim loads a real page
// through the proxy, returns ERR_NAME_NOT_RESOLVED without it, and returns
// ERR_PROXY_CONNECTION_FAILED — never a direct load — once the tunnel is killed.
//
//
// Everything a browser has no business reading.
//
// Chromium runs without its own sandbox (see chromiumJailArguments), so a page
// that achieves code execution in a renderer inherits this process's filesystem
// rights. Measured with sandbox_check against live renderers: under the shared
// profile it could read ~/Documents, ~/Library/Keychains and the rest of the
// home directory, and it could still post what it read through the one
// permitted destination. The egress boundary was never going to stop that —
// it is a theft primitive, not an egress one.
//
// So the browser gets its own, tighter profile. This is NOT equivalent to
// Chromium's native sandbox and must not be described as such: it is one coarse
// deny-list for the whole browser rather than per-process allow-lists, it does
// not deny fork, it does not touch Mojo or renderer-to-browser IPC, and headful
// still needs the window server. What it removes is the specific primitive
// above.
//
const BROWSER_DENIED_READS = [
  "~/.ssh",
  "~/.aws",
  "~/.gnupg",
  "~/.kube",
  "~/.docker",
  "~/.config",
  "~/.netrc",
  "~/.npmrc",
  "~/Library/Keychains",
  "~/Library/Cookies",
  "~/Library/Messages",
  "~/Library/Application Support/Google/Chrome",
  "~/Library/Application Support/Firefox",
  "~/Library/Application Support/BraveSoftware",
  "~/Documents",
  "~/Desktop",
];

function buildChromiumProfile(options: JailOptions, executablePath: string): string {
  const home = homedir();
  const denied = BROWSER_DENIED_READS.map(
    (entry) => `  (subpath ${JSON.stringify(path.join(home, entry.slice(2)))})`,
  ).join("\n");
  //
  // Derived from the resolved binary rather than hardcoded, so it follows an
  // owner-supplied LOCAL_STUDIO_CHROME_PATH. Chromium execs its own helpers, so
  // its install root has to stay executable; nothing else does.
  //
  const installRoot = chromiumInstallRoot(executablePath);
  return `${buildProfile(options)}
(deny file-read*
${denied}
)

(deny process-exec*)
(allow process-exec* (subpath ${JSON.stringify(installRoot)}))
(allow process-exec (literal ${JSON.stringify(SANDBOX_EXEC)}))
`;
}

//
// The .app bundle, or the directory holding a bare binary. Chromium's helpers
// live beside it either way.
//
function chromiumInstallRoot(executablePath: string): string {
  const resolved = path.resolve(executablePath);
  const app = resolved.indexOf(".app/");
  return app > 0 ? resolved.slice(0, app + 4) : path.dirname(resolved);
}

export function writeChromiumShim(
  profileDirectory: string,
  profilePath: string,
  executablePath: string,
  options?: JailOptions,
): string {
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  //
  // The browser runs under its own profile when one can be built, and falls
  // back to the shared jail otherwise. Both confine egress identically; only
  // the filesystem and exec denials differ.
  //
  let applied = profilePath;
  if (options) {
    applied = path.join(profileDirectory, `chromium-${options.proxyPort}.sb`);
    writeFileSync(applied, buildChromiumProfile(options, executablePath), { mode: 0o600 });
  }
  const shim = path.join(profileDirectory, "chromium-jail.sh");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec ${SANDBOX_EXEC} -f ${shellQuote(applied)} ${shellQuote(executablePath)} "$@"\n`,
    { mode: 0o700 },
  );
  return shim;
}

//
// The model's own `bash` tool does not go through this runtime's PTY service —
// the SDK spawns the shell itself, and on Unix it hardcodes /bin/bash with no
// environment override. Its one supported seam is `shellPath` in the agent's
// settings, so protection points that at a shim that execs sandbox-exec and
// then the real shell. Same trick as the Chromium shim, and the same reason it
// holds: exec replaces the process, and the jail is inherited by everything the
// command goes on to run — curl, git, npm, pip, ssh, a python script.
//
export function writeShellShim(profileDirectory: string, profilePath: string): string {
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  const shell = existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  const shim = path.join(profileDirectory, "shell-jail.sh");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec ${SANDBOX_EXEC} -f ${shellQuote(profilePath)} ${shell} "$@"\n`,
    { mode: 0o700 },
  );
  return shim;
}

//
// Named honestly, and rendered in the UI. A path listed here is one this
// boundary is known not to cover, and its presence is what keeps the status
// from claiming more than was built.
//
export function unconfinedPaths(): string[] {
  return [
    "the reader and browser_search run in this process and are routed in code, not confined by the kernel",
    "remote MCP connectors cannot be routed and are refused while protection is on",
    "a socket connected before the jail and passed in as a descriptor stays writable",
  ];
}
