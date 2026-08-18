/**
 * Why Usage can be empty, said plainly.
 *
 * Before this, any failure reaching the controller rendered as the raw transport
 * string - "Request failed" - which tells the reader nothing about whether the
 * rig is off, the key is wrong, or the page itself is broken. The Usage surface
 * lives on a remote controller that is legitimately offline much of the time, so
 * "offline" is a normal state and deserves to be named rather than reported as an
 * error.
 */
export type UsageFailure = "offline" | "auth" | "unsupported" | "error";

export interface UsageFailureCopy {
  kind: UsageFailure;
  title: string;
  detail: string;
}

const AUTH = /\b(401|403)\b|unauthor|forbidden|invalid api key/i;
const MISSING = /\b404\b|not found/i;
const OFFLINE =
  /failed to fetch|networkerror|load failed|econnrefused|ehostunreach|enotfound|etimedout|timeout|aborted|socket hang up|\b(502|503|504)\b/i;

export function classifyUsageFailure(message: string | null | undefined): UsageFailureCopy | null {
  if (!message) return null;
  const text = message.trim();
  if (!text) return null;

  if (AUTH.test(text)) {
    return {
      kind: "auth",
      title: "The controller rejected this key",
      detail:
        "Usage is reachable but not authorised. Check the API key in Settings against the one the controller expects.",
    };
  }
  if (MISSING.test(text)) {
    return {
      kind: "unsupported",
      title: "This controller does not report usage",
      detail:
        "The selected controller answered, but it has no usage endpoint. Nothing is wrong with the rig - this build simply does not account for requests.",
    };
  }
  if (OFFLINE.test(text)) {
    return {
      kind: "offline",
      title: "Controller offline",
      detail:
        "Usage comes from the same controller that serves Chat. It is not answering right now, so there are no numbers to show - not zero numbers.",
    };
  }
  return { kind: "error", title: "Usage could not be loaded", detail: text };
}

/** Renders the ISO timestamp the backend reports, or null when it reports none. */
export function formatCollectionStart(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
