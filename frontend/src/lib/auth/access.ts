// Shared, runtime-agnostic access-control logic for the frontend.
//
// The frontend serves an in-process coding agent with shell/filesystem tools,
// so its API surface is privileged: reaching it is equivalent to code execution
// on the host. Access is therefore gated by an opt-in shared secret. The default
// posture is safe-by-default — open for local development and the embedded
// desktop app, and locked when running as a production web server without an
// explicit token or opt-out. This mirrors the controller's bind/auth policy.
//
// This module imports nothing Node-specific so it can run in both the Edge
// middleware and Node route handlers; the constant-time comparison here is a
// pure-JS fallback. Node route guards use node:crypto timingSafeEqual instead.

export const STUDIO_TOKEN_HEADER = "x-local-studio-token";
export const STUDIO_TOKEN_COOKIE = "local_studio_token";

export type AccessDecision =
  | { kind: "allow"; reason: "desktop" | "development" | "no-token" }
  | { kind: "require-token"; token: string };

function trimmedEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

// Resolve the access posture from environment. Pure function of env so the edge
// middleware and the node route guards always agree.
//
// Gating is OPT-IN: the app is open by default (so a fresh local/desktop setup
// is unchanged), and only requires a token once LOCAL_STUDIO_FRONTEND_TOKEN is
// set. Set the token when serving the frontend on an untrusted network.
export function resolveAccessPosture(): AccessDecision {
  //
  // AN EXPLICIT TOKEN ALWAYS WINS, including over the desktop posture.
  //
  // The desktop build used to answer everything unauthenticated, on the correct
  // reasoning that it binds 127.0.0.1 and nothing off the machine can address
  // that. But the owner can publish it — `tailscale serve`, a reverse proxy —
  // and the process cannot tell that happened: such a proxy runs on this machine
  // and connects over loopback like anything else. A Host-header check does not
  // help either, since the client chooses the Host header.
  //
  // So the signal is the one thing a client cannot forge: whether the OWNER set
  // a token. Setting it is the act of saying "this is reachable from somewhere
  // I do not fully trust", and from then on every request needs it — the desktop
  // window included, which the Electron shell handles by seeding the cookie into
  // its own session.
  //
  const token = trimmedEnv("LOCAL_STUDIO_FRONTEND_TOKEN");
  if (token) return { kind: "require-token", token };
  // The desktop app embeds a loopback-only Next server.
  if (trimmedEnv("LOCAL_STUDIO_DATA_DIR")) return { kind: "allow", reason: "desktop" };
  // Local development (`next dev`) is loopback and single-user.
  if (process.env.NODE_ENV !== "production") return { kind: "allow", reason: "development" };
  // No token configured: open. Setting the token is the opt-in to gating.
  return { kind: "allow", reason: "no-token" };
}

// Constant-time string comparison usable in both Edge and Node runtimes.
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function presentedToken(
  headerToken: string | null,
  cookieToken: string | null | undefined,
): string {
  return (headerToken ?? cookieToken ?? "").trim();
}
