//
// The shared secret that gates the embedded frontend when it is published.
//
// The desktop build answers loopback requests unauthenticated, which is correct
// while 127.0.0.1 is the only way in. Publishing it — `tailscale serve` in front
// of it, or any reverse proxy — breaks that assumption, and the process cannot
// detect that it happened: such a proxy runs on this machine and connects over
// loopback like anything else.
//
// So the token is the opt-in. Its PRESENCE is the switch: while this file does
// not exist nothing changes and the app behaves exactly as it always has; once
// it exists, `resolveAccessPosture` requires the token for every request, and
// the window seeds it into its own session so the owner is not locked out of
// their own app.
//
// It is deliberately a file rather than an environment variable: a GUI app on
// macOS does not inherit a shell's environment, so an env var would have to be
// set through launchctl and would silently stop applying after a reboot — the
// failure mode being an app that quietly went back to unauthenticated while
// still published.
//

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FILENAME = "frontend-token";

function tokenPath(userDataDir: string): string {
  return path.join(userDataDir, FILENAME);
}

//
// Read-only, deliberately. These files are written by `npm run remote-access`,
// the owner's single act of publishing the app; a reader that created one on
// first call would turn remote access on by accident on first launch.
//
export function readFrontendToken(userDataDir: string): string | null {
  const filepath = tokenPath(userDataDir);
  if (!existsSync(filepath)) return null;
  try {
    const token = readFileSync(filepath, "utf8").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

//
// The hostname the app is published under, written by the same command that
// starts `tailscale serve`.
//
// `tailscale serve` rewrites Host to the MagicDNS name before it reaches the
// embedded server, and the request boundary rejects any Host it was not told
// about — correctly, since an unrecognised Host is how DNS-rebinding and
// confused-deputy proxying start. So publishing has to name the host it
// publishes under; the boundary is not going to guess.
//
// Kept beside the token rather than derived from `tailscale status` so that the
// widening and the gate are written by one deliberate act. app-server.ts only
// passes this through when a token exists, which is what makes it impossible to
// widen the allowlist without also demanding the token.
//
const HOST_FILENAME = "remote-host";

export function readRemoteHost(userDataDir: string): string | null {
  try {
    const host = readFileSync(path.join(userDataDir, HOST_FILENAME), "utf8").trim().toLowerCase();
    return /^[a-z0-9.-]+$/.test(host) && host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

//
// The tailnet identity allowed to reach the published app.
//
// `tailscale serve` overwrites Tailscale-User-Login on every request it
// forwards — a remote caller cannot forge it — so this is a real second lock:
// a token that leaks still has to arrive from the owner's own tailnet identity.
// It says nothing about loopback callers, where the header is trivially forged
// by any local process and the boundary ignores it for exactly that reason.
//
const USER_FILENAME = "remote-user";

export function readRemoteUser(userDataDir: string): string | null {
  try {
    const user = readFileSync(path.join(userDataDir, USER_FILENAME), "utf8").trim().toLowerCase();
    return /^[^\s,]+@[^\s,]+$/.test(user) ? user : null;
  } catch {
    return null;
  }
}
