//
// UPSTREAM REACHABILITY BREAKER, PROXY SIDE.
//
// The client has one of these too, and it is not redundant with this one. That
// breaker stops a browser from queueing more calls; this one stops the ones it
// does send from occupying a socket for the full budget. Both matter, because a
// browser allows only a handful of concurrent connections per origin: requests
// parked for five seconds against a sleeping controller crowd out the LOCAL
// /api/agent/* calls that share this origin, which is how a host that only some
// screens need ends up stalling the whole app.
//
// Same shape as the client's: latch on an upstream timeout, serve the verdict
// immediately during a cooldown, then let exactly one request through to find
// out whether the host is back, and reopen on any success.
//
const COOLDOWN_MS = 15_000;

//
// `probeInFlight` means "one request is currently out there finding out whether
// the host is back", NOT "the host is down" — conflating the two is what made
// the first version never reopen: the flag was set the moment the breaker
// latched, so the half-open branch that clears it was unreachable and a woken
// RTX stayed blocked forever.
//
type BreakerState = { downSince: number; probeInFlight: boolean };

// Module scope, which in this server is per-process and therefore shared across
// every request — the point of the thing.
const breakers = new Map<string, BreakerState>();

export type BreakerVerdict = "open" | "closed" | "probe";

export function upstreamVerdict(url: string): BreakerVerdict {
  const state = breakers.get(url);
  if (!state) return "closed";
  if (Date.now() - state.downSince < COOLDOWN_MS) return "open";
  // Cooldown spent. Exactly one caller goes and looks; everyone else keeps the
  // fast answer until it reports back.
  if (state.probeInFlight) return "open";
  state.probeInFlight = true;
  return "probe";
}

export function markUpstreamDown(url: string): void {
  // Whether this is the first failure or a probe that came back empty, the
  // answer is the same: restart the cooldown and let the next probe happen
  // after it.
  breakers.set(url, { downSince: Date.now(), probeInFlight: false });
}

export function markUpstreamUp(url: string): void {
  breakers.delete(url);
}

/** The origin a breaker is keyed by. Two calls to different paths on the same
 *  sleeping host are the same fact, so they share one entry. */
export function upstreamKey(targetUrl: string): string {
  try {
    return new URL(targetUrl).origin;
  } catch {
    return targetUrl;
  }
}
