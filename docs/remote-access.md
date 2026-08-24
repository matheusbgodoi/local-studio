# Remote access over Tailscale

Local Studio normally binds `127.0.0.1` and answers everything without
authentication, which is correct while loopback is the only way in. This
document covers turning that off: publishing the app so a phone can reach it,
and what actually stops anyone else from doing the same.

## Turning it on

```
npm run remote-access
```

Run it once, with Local Studio already started at least once. It:

1. writes three files into `~/Library/Application Support/Local Studio/`,
   all mode `0600` — `frontend-token` (32 random bytes, base64url),
   `remote-host` (this machine's MagicDNS name) and `remote-user` (the tailnet
   identity that owns this machine);
2. points `tailscale serve` at the port the app persisted for itself;
3. prints a one-time pairing URL.

Restart Local Studio, then open the pairing URL **once** on the phone. The token
moves into an `httpOnly` cookie and the URL redirects to a clean one, so the
secret stops travelling in the address bar. Afterwards use the plain
`https://<machine>.<tailnet>.ts.net/agent` and Add to Home Screen from there.

Turn it off with `npm run remote-access -- --off`, which resets the serve config
and deletes all three files. Restart the app afterwards.

## What makes it private

Three independent things, in the order a request meets them.

**It is not on the public internet.** `tailscale serve` without `--funnel`
publishes inside the tailnet only. Measured: the name has no record in public
DNS (`dig @8.8.8.8` is empty), there is no host-level listener on 443
(`lsof -iTCP:443 -sTCP:LISTEN` is empty — port 443 exists only inside the
Tailscale tun), and the LAN address times out. The serve config contains no
`AllowFunnel` key, and its absence is what keeps it tailnet-only.

**Every request needs the token.** Presence of `frontend-token` is the switch:
while the file does not exist the app behaves exactly as it always has, and once
it does, `resolveAccessPosture` requires the token of every caller — the desktop
window (which gets it as a cookie), the app's own readiness probe, and the agent
runtime's tool extensions included.

There is deliberately **no exemption for callers that look local**. An earlier
version exempted any request presenting a loopback `Host`, on the assumption
that `tailscale serve` rewrites Host and so a remote request could never look
local. That assumption was false and a second tailnet device disproved it:
serve forwards the client's `Host` unchanged, so `curl -H "Host: 127.0.0.1"`
reached the agent API unauthenticated. Any client-supplied field would have had
the same flaw. The token is now the only thing that opens the door.

**Only one tailnet identity.** `serve` overwrites `Tailscale-User-Login` on
every request it forwards — a forged value was measured being replaced with the
true one — so `ALLOWED_TAILSCALE_USERS` is a real second lock: a leaked token
still has to arrive from the owner's own tailnet identity. It says nothing about
callers reaching the port directly, where any local process can forge the header,
and the app does not treat it as meaning anything there.

The host allowlist (`ALLOWED_TAILSCALE_HOSTS`) is passed to the server **only**
when a token exists, so the widening and the gate can never drift apart.

## Port drift

The app persists its port, but that port sits in macOS's ephemeral range
(49152–65535) and a transient outbound connection can hold it at launch, in
which case the app picks a different one. A serve config pinned to the old port
does not error — it answers 502 to the phone, permanently, with nothing on this
machine saying why. So the app re-points serve at its live port on every launch.
This never enables serve and never picks a hostname; it only corrects the port of
a handler the owner deliberately created.

## Limits

- **The Mac has to be awake and online.** The agents run there; the phone is a
  remote control, not a copy. There is no offline mode — the service worker is
  off by default and self-unregisters.
- **Terminal, dictation and the native file picker are desktop-only.** The
  browser client degrades to a server-side PTY for the terminal; the others are
  Electron bridges with no web equivalent and are simply absent.
- **A raw TCP forward would bypass the tailnet, not the token.** Anything that
  forwards to the loopback port (`ssh -L`) still has to present the token, but it
  is not subject to the tailnet identity check. It also requires shell access to
  this machine as this user, which is already game over.
- **A local process can read the token.** It is a `0600` file owned by this user,
  so anything running as this user can read it — including the agent itself. The
  token defends the published surface, not this machine from itself.
