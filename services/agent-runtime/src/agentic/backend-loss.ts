//
// Telling "the backend went away" apart from "the work is wrong".
//
// A Run survives the process being killed: recovery settles the interrupted
// attempts, resets the task that was mid-flight and reopens the Run as PAUSED.
// The same Run did NOT survive the machine serving the model dropping off the
// network for a minute — any throw inside the drive loop marked it FAILED, and
// FAILED is where a Run goes to stay. The final acceptance run died that way
// with three of five tasks proved and two compactions recorded, none of which
// the owner could get back.
//
// Losing the backend is the same accident as losing the process: work stopped
// in the middle and nothing about the goal was decided. So it takes the same
// road — reconcile, pause, wait to be resumed — and only errors that say
// something about the WORK end a Run for good.
//

//
// Matched against the message because that is all a fetch rejection carries by
// the time it crosses the SDK. Each entry is a way the local stack reports "I
// could not reach the server", collected from the ones actually seen: undici's
// bare `fetch failed`, the OS refusing or timing out the connection, the proxy
// in front of the host answering while the host itself is gone, and an abort
// that fired because nothing answered in time.
//
const BACKEND_LOSS_SIGNATURES = [
  "fetch failed",
  "econnrefused",
  "econnreset",
  "enotfound",
  "ehostunreach",
  "enetunreach",
  "etimedout",
  "socket hang up",
  "network error",
  "connection refused",
  "connection reset",
  "operation was aborted",
  "request timed out",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "502",
  "503",
  "504",
];

export function isBackendLoss(error: unknown): boolean {
  const message = messageOf(error).toLowerCase();
  if (!message) return false;
  return BACKEND_LOSS_SIGNATURES.some((signature) => message.includes(signature));
}

//
// A fetch rejection usually hides the real reason one level down, in `cause`.
// Reading only the top message gets the useless half ("fetch failed") and, for
// anything wrapped twice, misses the signature entirely.
//
function messageOf(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    const record = current as { message?: unknown; cause?: unknown; code?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.code === "string") parts.push(record.code);
    current = record.cause;
  }
  return parts.join(" | ");
}
