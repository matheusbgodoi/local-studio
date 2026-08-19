import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeBrowserPaneUrl } from "../../../../shared/agent/sanitize-embedded-browser-url";
import { browserHost, type KeyInput, type MouseInput } from "../browser-host/browser-host";
import {
  challengeNotice,
  clearChallenge,
  detectChallenge,
  pendingChallenge,
  rememberChallenge,
  type ChallengeDetection,
} from "../browser-host/challenge";
import { fetchReadable } from "../browser-host/reader";
import { webSearch } from "../browser-host/search";

const ALLOWED_VERBS = new Set([
  "navigate",
  "get-url",
  "get-text",
  "get-html",
  "screenshot",
  "click",
  "scroll",
  "fill",
  "back",
  "forward",
  "reload",
  "search",
  "verify",
]);

const UNAVAILABLE_ERROR = "Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH";

let lastFallbackUrl = "";

type VerbResult = { ok: boolean; data?: unknown; error?: string };

export async function handleBrowserVerb(request: Request, verb: string): Promise<Response> {
  if (!ALLOWED_VERBS.has(verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  const payload = await readPayload(request);
  try {
    const result = await dispatchVerb(verb, payload);
    return Response.json(result);
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Browser command failed",
    });
  }
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      // sessionId was a renderer-bridge affinity hint; the host is global now.
      const { sessionId: _sessionId, ...rest } = body;
      return rest;
    }
  } catch {
    // empty body is fine
  }
  return {};
}

async function dispatchVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  // Search never needs Chromium: it is an HTTP fetch through the reader's
  // transport, so it keeps working on a machine with no browser at all.
  if (verb === "search") return searchVerb(payload);
  if (!browserHost.isAvailable()) return fallbackVerb(verb, payload);
  try {
    return await runHostVerb(verb, payload);
  } catch (error) {
    // A launch/connection failure for the reading verbs still degrades to
    // reading mode rather than failing the tool call outright.
    if (verb === "navigate" || verb === "get-text") return fallbackVerb(verb, payload);
    throw error;
  }
}

async function runHostVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  switch (verb) {
    case "navigate":
      return navigateVerb(payload);
    case "search":
      return searchVerb(payload);
    case "verify":
      return verifyVerb(payload);
    case "get-url":
      return { ok: true, data: await browserHost.getUrl() };
    case "get-text":
      return readVerb("text");
    case "get-html":
      return readVerb("html");
    case "screenshot":
      return { ok: true, data: { dataUri: await browserHost.screenshot() } };
    case "click":
      return selectorVerb(await browserHost.click({ selector: requireSelector(payload) }));
    case "fill":
      return selectorVerb(
        await browserHost.fill({
          selector: requireSelector(payload),
          value: String(payload.value ?? ""),
        }),
      );
    case "scroll":
      return scrollVerb(payload);
    case "back":
      await browserHost.goBack();
      return { ok: true, data: await browserHost.getState() };
    case "forward":
      await browserHost.goForward();
      return { ok: true, data: await browserHost.getState() };
    case "reload":
      await browserHost.reload();
      return { ok: true, data: await browserHost.getState() };
    default:
      return { ok: false, error: `Unsupported browser verb: ${verb}` };
  }
}

async function navigateVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  // Pane rules: public web plus loopback (previewing local dev servers is the
  // pane's main job); other private ranges stay blocked.
  const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
  if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
  // A site that has already asked for a human is not asked again on a timer.
  // Declining locally is the whole point: no refresh loop, no user-agent
  // shuffling, no proxy - the page and its cookies are simply left as they are.
  const outstanding = pendingChallenge(url);
  if (outstanding) return challengeResult(outstanding);
  const result = await browserHost.navigate(url);
  return afterRead({ ok: true, data: result });
}

// Every read of the live page is also a challenge check, which is what lets the
// model resume by itself once the owner has verified: the next get-text simply
// comes back with the page instead of the notice.
async function readVerb(kind: "text" | "html"): Promise<VerbResult> {
  const state = await browserHost.getState();
  const body = kind === "text" ? await browserHost.getText() : await browserHost.getHtml();
  const detection = detectChallenge({
    url: state.url,
    title: state.title,
    ...(kind === "text" ? { text: body } : { html: body }),
  });
  if (detection) {
    rememberChallenge(detection);
    return challengeResult(detection);
  }
  clearChallenge(state.url);
  return { ok: true, data: kind === "text" ? { text: body } : { html: body } };
}

async function afterRead(result: VerbResult): Promise<VerbResult> {
  const url = (result.data as { url?: string } | undefined)?.url;
  if (!url) return result;
  const state = await browserHost.getState().catch(() => null);
  if (!state) return result;
  const detection = detectChallenge({ url: state.url, title: state.title });
  if (!detection) return result;
  rememberChallenge(detection);
  return challengeResult(detection);
}

function challengeResult(detection: ChallengeDetection): VerbResult {
  return {
    ok: true,
    data: {
      verificationRequired: true,
      provider: detection.provider,
      site: detection.site,
      url: detection.url,
      reason: detection.reason,
      notice: challengeNotice(detection),
    },
  };
}

async function verifyVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  const raw = String(payload.url ?? "").trim();
  const url = raw ? sanitizeBrowserPaneUrl(raw) : "";
  if (raw && !url) return { ok: false, error: "valid public or localhost http(s) url required" };
  const state = await browserHost.openForVerification(url || undefined);
  if (url) clearChallenge(url);
  return {
    ok: true,
    data: {
      ...state,
      interactive: true,
      notice:
        "A visible browser window is open on the same Local Studio profile. Complete the verification or sign-in there, then read the page again. Nothing is solved automatically.",
    },
  };
}

async function searchVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  const query = String(payload.query ?? "").trim();
  if (!query) return { ok: false, error: "query required" };
  const outcome = await webSearch(query, payload.maxResults);
  if (outcome.verificationRequired) {
    return {
      ok: true,
      data: {
        query: outcome.query,
        results: [],
        verificationRequired: true,
        provider: outcome.verificationRequired.provider,
        site: outcome.verificationRequired.site,
        url: outcome.verificationRequired.url,
        reason: outcome.verificationRequired.reason,
        notice: challengeNotice(outcome.verificationRequired),
      },
    };
  }
  return {
    ok: true,
    data: {
      query: outcome.query,
      provider: outcome.provider,
      count: outcome.results.length,
      cached: outcome.cached,
      results: outcome.results,
      ...(outcome.note ? { note: outcome.note } : {}),
    },
  };
}

async function scrollVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  const deltaY = Number(payload.deltaY ?? 0);
  const result = await browserHost.scroll({ deltaY: Number.isFinite(deltaY) ? deltaY : 0 });
  return { ok: true, data: { deltaY: result.deltaY, scrollY: result.scrollY } };
}

function selectorVerb(result: { found: boolean }): VerbResult {
  return {
    ok: result.found,
    data: { found: result.found },
    ...(result.found ? {} : { error: "selector not found" }),
  };
}

function requireSelector(payload: Record<string, unknown>): string {
  const selector = String(payload.selector ?? "");
  if (!selector) throw new Error("selector required");
  return selector;
}

// Chromium-unavailable fallbacks. navigate/get-url/get-text/get-html degrade to
// reading mode (remembering the last navigated URL per process so reads work
// without a url arg); every other verb returns the clear unavailable error. The
// fallback honors pane rules (public + loopback) so local dev servers stay
// previewable even when there's no headless Chromium to drive a full surface.
async function fallbackVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  if (verb === "navigate") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
    if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
    const reader = await fetchReadable(url);
    lastFallbackUrl = reader.url;
    return { ok: true, data: { url: reader.url, title: reader.title, readingMode: true } };
  }
  if (verb === "get-url") {
    return { ok: true, data: { url: lastFallbackUrl, title: "" } };
  }
  if (verb === "get-text" || verb === "get-html") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? "")) || lastFallbackUrl;
    if (!url) return { ok: false, error: UNAVAILABLE_ERROR };
    const reader = await fetchReadable(url);
    lastFallbackUrl = reader.url;
    return verb === "get-text"
      ? { ok: true, data: { text: reader.text, readingMode: true } }
      : { ok: true, data: { html: reader.markdown ?? reader.text, readingMode: true } };
  }
  return { ok: false, error: UNAVAILABLE_ERROR };
}

export async function handleBrowserFetch(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return Response.json({ error: "url is required" }, { status: 400 });
  try {
    const result = await fetchReadable(raw);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    // Only the initial url-rejection is a client error (400); resolved-host,
    // redirect, and upstream failures are bad-gateway (502) like before.
    const status = message.startsWith("url rejected") ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

// ─── GET /api/agent/browser/frame ─────────────────────────────────────────
//
// Frame poll for the visible browser panel (~10fps JSON poll instead of SSE:
// Next's standalone server buffers locally-built event streams, and polling
// survives buffering proxies for remote deploys).

export async function handleBrowserFrame(): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: UNAVAILABLE_ERROR }, { status: 503 });
  }
  try {
    const { frame, state } = await browserHost.pollFrame();
    return Response.json({
      ok: true,
      data: {
        frame: frame?.data ?? null,
        url: state.url,
        title: state.title,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "frame poll failed",
    });
  }
}

type InputBody =
  | ({ kind: "mouse" } & Omit<MouseInput, "type"> & { type: MouseInput["type"] })
  | ({ kind: "wheel" } & Omit<MouseInput, "type">)
  | ({ kind: "key" } & KeyInput);

export async function handleBrowserInput(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: InputBody;
  try {
    body = (await request.json()) as InputBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await dispatchInput(body);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "input dispatch failed",
    });
  }
}

async function dispatchInput(body: InputBody): Promise<void> {
  if (body.kind === "key") {
    await browserHost.dispatchKey({
      type: body.type,
      key: body.key,
      code: body.code,
    });
    return;
  }
  if (body.kind === "wheel") {
    await browserHost.dispatchMouse({
      type: "wheel",
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      deltaX: body.deltaX,
      deltaY: body.deltaY,
    });
    return;
  }
  await browserHost.dispatchMouse({
    type: body.type,
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
    button: body.button,
    clickCount: body.clickCount,
  });
}

// ─── GET /api/agent/browser/localhosts ────────────────────────────────────
//
// Discovers locally listening HTTP dev servers for the browser panel's
// localhost picker.

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 650;
const LSOF_TIMEOUT_MS = 2_500;
const MAX_CANDIDATES = 48;
const FALLBACK_PORTS = [3000, 3001, 3002, 3017, 4173, 5173, 5174, 8000, 8080, 8317, 1234];

type PortCandidate = {
  port: number;
  process?: string;
};

type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

function parseCurrentPort(request: Request): number | null {
  const host = request.headers.get("host") ?? "";
  const match = host.match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  return Number.isFinite(port) ? port : null;
}

function titleFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  return title
    ? title
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    : "";
}

function parseLsof(stdout: string): PortCandidate[] {
  const byPort = new Map<number, PortCandidate>();
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const listenMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (!listenMatch) continue;
    const port = Number(listenMatch[1]);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
    const processName = line.trim().split(/\s+/)[0];
    if (!byPort.has(port)) byPort.set(port, { port, process: processName });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port).slice(0, MAX_CANDIDATES);
}

async function listListeningPorts(): Promise<PortCandidate[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const ports = parseLsof(stdout);
    if (ports.length > 0) return ports;
  } catch {
    // Fall through to common dev-server ports.
  }
  return FALLBACK_PORTS.map((port) => ({ port }));
}

async function probePort(
  candidate: PortCandidate,
  currentPort: number | null,
): Promise<LocalhostSite | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const url = `http://127.0.0.1:${candidate.port}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    let title = "";
    if (contentType.includes("text/html")) {
      title = titleFromHtml((await response.text()).slice(0, 64_000));
    }
    const displayUrl = `localhost:${candidate.port}`;
    return {
      port: candidate.port,
      url: `http://${displayUrl}`,
      displayUrl,
      title: title || displayUrl,
      process: candidate.process,
      current: candidate.port === currentPort,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleBrowserLocalhosts(request: Request): Promise<Response> {
  const currentPort = parseCurrentPort(request);
  const candidates = await listListeningPorts();
  const probed = await Promise.all(
    candidates.map((candidate) => probePort(candidate, currentPort)),
  );
  const sites = probed
    .filter((site): site is LocalhostSite => Boolean(site))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return a.port - b.port;
    });
  return Response.json({ sites });
}

// ─── GET /api/agent/browser/state ─────────────────────────────────────────

export async function handleBrowserState(): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, data: await browserHost.peekState() });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "getState failed",
    });
  }
}

// ─── POST /api/agent/browser/viewport ─────────────────────────────────────
//
// Sets the headless Chromium viewport so it matches the visible panel's
// dimensions. Body: { width, height }.

export async function handleBrowserViewport(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: { width?: unknown; height?: unknown };
  try {
    body = (await request.json()) as { width?: unknown; height?: unknown };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Response.json({ ok: false, error: "width and height are required" }, { status: 400 });
  }
  try {
    await browserHost.setViewport(width, height);
    return Response.json({
      ok: true,
      data: { width: Math.round(width), height: Math.round(height) },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "setViewport failed",
    });
  }
}
