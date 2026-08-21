const ABSENT_ROUTE_STATUSES = new Set([404, 405, 501]);
const MAX_DETAIL_CHARS = 240;

/** A status that means "this route is not here", as opposed to "this route failed".
 *
 * A function rather than an inlined `.has()` at each site, so the places that ask the question
 * cannot drift apart. Exported now that `use-downloads` asks it too — it latches `unsupported`
 * and stops re-arming its poll when the route will never exist, which is the same question this
 * module answers for retries and for error text. Three copies of that status set would be three
 * chances to disagree. */
export function isAbsentRouteStatus(status: number | undefined): boolean {
  return status !== undefined && ABSENT_ROUTE_STATUSES.has(status);
}

export function isRetryableError(error: unknown, status?: number): boolean {
  if (isAbsentRouteStatus(status)) return false;
  if (status && status >= 500) return true;
  if (status === 429) return true;
  if (status === 408) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "AbortError") return false;
  return false;
}

function clip(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  return collapsed.length > MAX_DETAIL_CHARS
    ? `${collapsed.slice(0, MAX_DETAIL_CHARS - 1)}…`
    : collapsed;
}

function joinValidationDetail(detail: unknown[]): string {
  const parts = detail.map((item) => {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const msg =
        typeof o["msg"] === "string"
          ? o["msg"].trim()
          : typeof o["message"] === "string"
            ? (o["message"] as string).trim()
            : "";
      if (msg) {
        const locRaw = o["loc"];
        const loc =
          Array.isArray(locRaw) && locRaw.length > 0
            ? locRaw
                .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
                .join(".")
            : "";
        return loc ? `${loc}: ${msg}` : msg;
      }
    }
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  });
  return parts.filter((p) => p.length > 0).join("; ");
}

function structuredDetail(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const detail = b["detail"];
  if (typeof detail === "string") return detail.trim() || null;
  if (Array.isArray(detail)) return joinValidationDetail(detail) || null;
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return null;
    }
  }

  const nested = b["error"];
  if (typeof nested === "string") return nested.trim() || null;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const msg = (nested as Record<string, unknown>)["message"];
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }

  const message = b["message"];
  if (typeof message === "string" && message.trim()) return message.trim();

  return null;
}

/** Does this plain-text body actually say anything, or is it the server's stock phrasing?
 *
 * Go's default mux answers "404 page not found"; nginx answers "Not Found". Neither tells the
 * reader anything the status code did not. But a 405 answering "Method Not Allowed: use POST"
 * does, and replacing THAT with a generic sentence throws away the only useful part of the
 * response. So the stock phrasings are recognised and stepped over; everything else wins. */
function isStockStatusText(text: string, status: number): boolean {
  const normalised = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalised) return true;
  const withoutStatus = normalised.replace(new RegExp(`\\b${status}\\b`, "g"), "").trim();
  return (
    withoutStatus === "" ||
    withoutStatus === "not found" ||
    withoutStatus === "page not found" ||
    withoutStatus === "method not allowed" ||
    withoutStatus === "not implemented"
  );
}

export function formatHttpErrorMessage(status: number, body: unknown, endpoint?: string): string {
  const structured = structuredDetail(body);
  if (structured) return `${status} — ${clip(structured)}`;

  const text = typeof body === "string" ? clip(body) : "";

  // The route phrasing is a REPLACEMENT for a body that said nothing, not a preemption of one
  // that did. Checking it first turned "405 — Method Not Allowed: use POST" into a sentence
  // that dropped the instruction.
  if (endpoint && isAbsentRouteStatus(status) && isStockStatusText(text, status)) {
    return `${status} — this backend does not implement ${endpoint}`;
  }

  return text ? `${status} — ${text}` : `HTTP ${status}`;
}
