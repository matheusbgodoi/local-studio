// Keyless web discovery, through the same vetted transport the reader uses.
//
// WHY DUCKDUCKGO'S HTML FRONTENDS AND NOTHING ELSE
//   The requirement was search with no API key, no account, no container and no
//   extra daemon. That rules out every paid API and every self-hosted meta
//   engine. DuckDuckGo publishes two no-JavaScript frontends intended for
//   browsers that cannot run scripts, and they answer a plain GET. They are
//   HTML PAGES, not a supported API: the markup can change without notice, and
//   this parser is best-effort by construction. When it stops matching, search
//   degrades to "no results" and says so - it never invents one.
//
// WHY ONE FALLBACK AND NOT A LADDER
//   html.duckduckgo.com first, lite.duckduckgo.com once if that fails. Then
//   stop. A provider that is rate-limiting or challenging does not want a third
//   request, and cycling endpoints to get around that is the behaviour this
//   feature is explicitly not allowed to have.
//
// WHAT THIS RETURNS
//   Discovery only: rank, title, url, domain, snippet. No page bodies. The model
//   picks one to three and reads those, which is the difference between a
//   research tool and a context furnace.

import { fetchPublicDocument } from "./reader";
import { detectChallenge, type ChallengeDetection } from "./challenge";

export type SearchResult = {
  rank: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
};

export type SearchProvider = "ddg-html" | "ddg-lite";

export type SearchOutcome = {
  query: string;
  provider: SearchProvider | null;
  results: SearchResult[];
  cached: boolean;
  verificationRequired?: ChallengeDetection;
  note?: string;
};

const DEFAULT_MAX_RESULTS = 8;
const HARD_MAX_RESULTS = 15;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_ENTRIES = 64;
// A provider that answered with a challenge or a 429 gets left alone for this
// long. Without it, a model retrying a failed search turns into exactly the
// hammering this feature must not do.
const PROVIDER_COOLDOWN_MS = 5 * 60_000;

const ENDPOINTS: Record<SearchProvider, (query: string) => string> = {
  "ddg-html": (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  "ddg-lite": (query) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
};

// ---------------------------------------------------------------------- CACHE
type CacheEntry = { at: number; outcome: SearchOutcome };

const cache = new Map<string, CacheEntry>();
const providerCooldown = new Map<SearchProvider, number>();

function cacheKey(query: string, maxResults: number): string {
  return `${normalizeQuery(query)}::${maxResults}`;
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function readCache(key: string, now: number): SearchOutcome | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { ...entry.outcome, cached: true };
}

function writeCache(key: string, outcome: SearchOutcome, now: number): void {
  cache.set(key, { at: now, outcome });
  while (cache.size > CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export function clearSearchCache(): void {
  cache.clear();
  providerCooldown.clear();
}

// After the owner has verified the search provider by hand, the local cooldown
// is the only thing still refusing — and refusing on behalf of a site that has
// just said yes is exactly the "keeps telling you to verify" failure this
// feature is meant to avoid.
export function clearProviderCooldown(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  let cleared = false;
  for (const provider of Object.keys(ENDPOINTS) as SearchProvider[]) {
    if (new URL(ENDPOINTS[provider]("x")).host.toLowerCase() !== host) continue;
    providerCooldown.delete(provider);
    cleared = true;
  }
  return cleared;
}

// ---------------------------------------------------------------- HTML PIECES
// Result titles are ordinary prose, so they carry the punctuation entities prose
// carries. Decoding only the XML five would leave "&middot;" sitting in a title
// the model then quotes back at the user.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">",
  middot: "\u00b7", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
  laquo: "\u00ab", raquo: "\u00bb", ldquo: "\u201c", rdquo: "\u201d",
  lsquo: "\u2018", rsquo: "\u2019", bull: "\u2022", deg: "\u00b0",
  times: "\u00d7", minus: "\u2212", copy: "\u00a9", reg: "\u00ae",
  trade: "\u2122", euro: "\u20ac", pound: "\u00a3", yen: "\u00a5",
  sect: "\u00a7", para: "\u00b6", dagger: "\u2020", prime: "\u2032",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => codePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&amp;/gi, "&");
}

function codePoint(value: number): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
}

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// DuckDuckGo wraps outbound links as /l/?uddg=<encoded target>. Unwrapping is
// deterministic, so the model gets the real destination rather than a tracker.
export function unwrapRedirect(href: string): string | null {
  const raw = decodeEntities(href.trim());
  if (!raw) return null;
  const absolute = raw.startsWith("//") ? `https:${raw}` : raw;
  let url: URL;
  try {
    url = new URL(absolute, "https://duckduckgo.com/");
  } catch {
    return null;
  }
  if (/(^|\.)duckduckgo\.com$/i.test(url.host)) {
    const target = url.searchParams.get("uddg");
    if (target) {
      try {
        const resolved = new URL(target);
        return resolved.protocol === "http:" || resolved.protocol === "https:"
          ? resolved.toString()
          : null;
      } catch {
        return null;
      }
    }
    // Anything else on the provider's own host is navigation or an ad beacon.
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
}

function isAdLink(href: string, block: string): boolean {
  return (
    /\/y\.js\?|duckduckgo\.com\/y\.js|ad_provider=|ad_domain=/i.test(href) ||
    /result--ad|badge--ad|\bSponsored\b/i.test(block)
  );
}

function canonical(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_|^ref$|^ref_src$|^source$/i.test(key)) parsed.searchParams.delete(key);
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host.replace(/^www\./i, "")}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------- PARSERS
type RawHit = { title: string; url: string; snippet: string };

// The HTML frontend puts every hit in a .result block: an <a class="result__a">
// for the link and a .result__snippet for the description.
export function parseDdgHtml(html: string): RawHit[] {
  const hits: RawHit[] = [];
  const blocks = html.split(/<div[^>]*class="[^"]*\bresults?_links?\b[^"]*"/i).slice(1);
  const source = blocks.length ? blocks : [html];
  for (const block of source) {
    const anchor = block.match(
      /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!anchor) continue;
    const href = anchor[1] ?? "";
    if (isAdLink(href, block)) continue;
    const url = unwrapRedirect(href);
    if (!url) continue;
    const title = plain(anchor[2] ?? "");
    if (!title) continue;
    const snippetMatch = block.match(
      /<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    hits.push({
      title,
      url,
      snippet: plain(snippetMatch?.[1] ?? snippetMatch?.[2] ?? ""),
    });
  }
  return hits;
}

// The Lite frontend is a table: a link row (a.result-link) followed by a
// snippet row (td.result-snippet).
export function parseDdgLite(html: string): RawHit[] {
  const hits: RawHit[] = [];
  const anchor = /<a[^>]*class="[^"]*\bresult-link\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/<td[^>]*class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)].map(
    (match) => plain(match[1] ?? ""),
  );
  let index = 0;
  for (const match of html.matchAll(anchor)) {
    const href = match[1] ?? "";
    const title = plain(match[2] ?? "");
    const snippet = snippets[index] ?? "";
    index += 1;
    if (isAdLink(href, match[0] ?? "")) continue;
    const url = unwrapRedirect(href);
    if (!url || !title) continue;
    hits.push({ title, url, snippet });
  }
  return hits;
}

// Deduplicate on the canonical target, drop empties, keep the engine's order.
// No reranking: the model asked the engine a question and the engine's answer
// order is information, not noise to be replaced by a second opinion.
export function normalizeHits(hits: RawHit[], maxResults: number): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const hit of hits) {
    const url = hit.url.trim();
    const title = hit.title.trim();
    if (!url || !title) continue;
    const key = canonical(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rank: out.length + 1,
      title,
      url,
      domain: domainOf(url),
      snippet: hit.snippet.trim(),
    });
    if (out.length >= maxResults) break;
  }
  return out;
}

export function clampMaxResults(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_RESULTS;
  return Math.min(HARD_MAX_RESULTS, Math.max(1, Math.trunc(parsed)));
}

// --------------------------------------------------------------------- FETCH
type ProviderAttempt =
  | { kind: "results"; hits: RawHit[] }
  | { kind: "challenge"; detection: ChallengeDetection }
  | { kind: "unavailable"; reason: string };

async function attempt(provider: SearchProvider, query: string, now: number): Promise<ProviderAttempt> {
  const cooldownUntil = providerCooldown.get(provider) ?? 0;
  if (now < cooldownUntil) {
    return { kind: "unavailable", reason: `${provider} is in cooldown after a rate limit or challenge` };
  }
  const endpoint = ENDPOINTS[provider](query);
  let document;
  try {
    document = await fetchPublicDocument(endpoint);
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  const title = document.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const detection = detectChallenge({
    url: document.url,
    status: document.status,
    title: plain(title),
    html: document.body,
  });
  if (detection) {
    providerCooldown.set(provider, now + PROVIDER_COOLDOWN_MS);
    return { kind: "challenge", detection };
  }
  if (document.status === 429) {
    providerCooldown.set(provider, now + PROVIDER_COOLDOWN_MS);
    return { kind: "unavailable", reason: `${provider} returned HTTP 429` };
  }
  if (document.status < 200 || document.status >= 400) {
    return { kind: "unavailable", reason: `${provider} returned HTTP ${document.status}` };
  }
  const hits = provider === "ddg-html" ? parseDdgHtml(document.body) : parseDdgLite(document.body);
  return { kind: "results", hits };
}

export async function webSearch(
  rawQuery: string,
  rawMaxResults?: unknown,
  now = Date.now(),
): Promise<SearchOutcome> {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  const maxResults = clampMaxResults(rawMaxResults);
  if (!query) {
    return { query, provider: null, results: [], cached: false, note: "empty query" };
  }

  const key = cacheKey(query, maxResults);
  const hit = readCache(key, now);
  if (hit) return hit;

  const primary = await attempt("ddg-html", query, now);
  if (primary.kind === "results" && primary.hits.length > 0) {
    const outcome: SearchOutcome = {
      query,
      provider: "ddg-html",
      results: normalizeHits(primary.hits, maxResults),
      cached: false,
    };
    writeCache(key, outcome, now);
    return outcome;
  }

  const fallback = await attempt("ddg-lite", query, now);
  if (fallback.kind === "results" && fallback.hits.length > 0) {
    const outcome: SearchOutcome = {
      query,
      provider: "ddg-lite",
      results: normalizeHits(fallback.hits, maxResults),
      cached: false,
    };
    writeCache(key, outcome, now);
    return outcome;
  }

  const detection =
    primary.kind === "challenge"
      ? primary.detection
      : fallback.kind === "challenge"
        ? fallback.detection
        : null;
  if (detection) {
    return {
      query,
      provider: null,
      results: [],
      cached: false,
      verificationRequired: detection,
      note: "Search is temporarily unavailable: the provider asked for human verification.",
    };
  }
  const reason =
    primary.kind === "unavailable"
      ? primary.reason
      : fallback.kind === "unavailable"
        ? fallback.reason
        : "no results";
  // An empty result set is not cached: a transient provider hiccup should not
  // silently answer "nothing found" for the next ten minutes.
  return { query, provider: null, results: [], cached: false, note: reason };
}
