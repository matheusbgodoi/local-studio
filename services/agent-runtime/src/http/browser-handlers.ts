import { AsyncLocalStorage } from "node:async_hooks";
import { Effect, Schema } from "effect";
import { BrowserSessionScopeSchema } from "../../../../shared/agent/browser-session";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeBrowserPaneUrl } from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  browserHostForSession,
  type BrowserHost,
  type KeyInput,
  type MouseInput,
} from "../browser-host/browser-host";
import {
  challengeNotice,
  clearChallenge as clearDefaultChallenge,
  detectChallenge,
  pendingChallenge as pendingDefaultChallenge,
  rememberChallenge as rememberDefaultChallenge,
  type ChallengeDetection,
} from "../browser-host/challenge";
import { fetchReadable } from "../browser-host/reader";
import { clearProviderCooldown, webSearch } from "../browser-host/search";

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

const scope = new AsyncLocalStorage<string>();
const fallbackUrls = new WeakMap<BrowserHost, string>();
const sessionChallenges = new WeakMap<BrowserHost, Map<string, ChallengeDetection>>();
const currentBrowser = () => browserHostForSession(scope.getStore());
const challengeKey = (url: string) => new URL(url).host;
function pendingChallenge(url: string): ChallengeDetection | null {
  if (!scope.getStore()) return pendingDefaultChallenge(url);
  return sessionChallenges.get(currentBrowser())?.get(challengeKey(url)) ?? null;
}
function rememberChallenge(value: ChallengeDetection): void {
  if (!scope.getStore()) return rememberDefaultChallenge(value);
  const host = currentBrowser();
  const entries = sessionChallenges.get(host) ?? new Map<string, ChallengeDetection>();
  entries.set(challengeKey(value.url), value);
  sessionChallenges.set(host, entries);
}
function clearChallenge(url: string): void {
  if (!scope.getStore()) return clearDefaultChallenge(url);
  sessionChallenges.get(currentBrowser())?.delete(challengeKey(url));
}

type VerbResult = { ok: boolean; data?: unknown; error?: string };

export async function handleBrowserVerb(request: Request, verb: string): Promise<Response> {
  if (!ALLOWED_VERBS.has(verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  const payload = await readPayload(request);
  try {
    const decoded = Schema.decodeUnknownSync(BrowserSessionScopeSchema)(payload);
    const sessionId = decoded.sessionId?.trim();
    if (sessionId && (sessionId.length > 256 || /[\u0000-\u001f]/.test(sessionId))) {
      return Response.json(
        { ok: false, error: "Invalid browser session identifier" },
        { status: 400 },
      );
    }
    const result = await scope.run(sessionId ?? "", () =>
      Effect.runPromise(
        Effect.tryPromise({
          try: () => dispatchVerb(verb, payload),
          catch: (error) => error,
        }),
      ),
    );
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
      return body;
    }
  } catch {}
  return {};
}

async function dispatchVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  if (verb === "search") return searchVerb(payload);
  if (!currentBrowser().isAvailable()) return fallbackVerb(verb, payload);
  try {
    return await runHostVerb(verb, payload);
  } catch (error) {
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
      return { ok: true, data: await currentBrowser().getUrl() };
    case "get-text":
      return readVerb("text");
    case "get-html":
      return readVerb("html");
    case "screenshot":
      return { ok: true, data: { dataUri: await currentBrowser().screenshot() } };
    case "click":
      return selectorVerb(await currentBrowser().click({ selector: requireSelector(payload) }));
    case "fill":
      return selectorVerb(
        await currentBrowser().fill({
          selector: requireSelector(payload),
          value: String(payload.value ?? ""),
        }),
      );
    case "scroll":
      return scrollVerb(payload);
    case "back":
      await currentBrowser().goBack();
      return { ok: true, data: await currentBrowser().getState() };
    case "forward":
      await currentBrowser().goForward();
      return { ok: true, data: await currentBrowser().getState() };
    case "reload":
      await currentBrowser().reload();
      return { ok: true, data: await currentBrowser().getState() };
    default:
      return { ok: false, error: `Unsupported browser verb: ${verb}` };
  }
}

async function navigateVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
  if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };

  const outstanding = pendingChallenge(url);
  if (outstanding) return challengeResult(outstanding);
  const result = await currentBrowser().navigate(url);
  return afterRead({ ok: true, data: result });
}

async function readVerb(kind: "text" | "html"): Promise<VerbResult> {
  const state = await currentBrowser().getState();
  const body =
    kind === "text" ? await currentBrowser().getText() : await currentBrowser().getHtml();
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
  const state = await currentBrowser()
    .getState()
    .catch(() => null);
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
  const state = await currentBrowser().openForVerification(url || undefined);
  if (url) {
    clearChallenge(url);
    clearProviderCooldown(url);
  }
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
  const result = await currentBrowser().scroll({ deltaY: Number.isFinite(deltaY) ? deltaY : 0 });
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

async function fallbackVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  if (verb === "navigate") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
    if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
    const reader = await fetchReadable(url);
    fallbackUrls.set(currentBrowser(), reader.url);
    return { ok: true, data: { url: reader.url, title: reader.title, readingMode: true } };
  }
  if (verb === "get-url") {
    return { ok: true, data: { url: fallbackUrls.get(currentBrowser()) ?? "", title: "" } };
  }
  if (verb === "get-text" || verb === "get-html") {
    const url =
      sanitizeBrowserPaneUrl(String(payload.url ?? "")) || fallbackUrls.get(currentBrowser());
    if (!url) return { ok: false, error: UNAVAILABLE_ERROR };
    const reader = await fetchReadable(url);
    fallbackUrls.set(currentBrowser(), reader.url);
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

    const status = message.startsWith("url rejected") ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

export async function handleBrowserFrame(): Promise<Response> {
  if (!currentBrowser().isAvailable()) {
    return Response.json({ ok: false, error: UNAVAILABLE_ERROR }, { status: 503 });
  }
  try {
    const { frame, state } = await currentBrowser().pollFrame();
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
  if (!currentBrowser().isAvailable()) {
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
    await currentBrowser().dispatchKey({
      type: body.type,
      key: body.key,
      code: body.code,
    });
    return;
  }
  if (body.kind === "wheel") {
    await currentBrowser().dispatchMouse({
      type: "wheel",
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      deltaX: body.deltaX,
      deltaY: body.deltaY,
    });
    return;
  }
  await currentBrowser().dispatchMouse({
    type: body.type,
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
    button: body.button,
    clickCount: body.clickCount,
  });
}

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
  } catch {}
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

export async function handleBrowserState(): Promise<Response> {
  if (!currentBrowser().isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, data: await currentBrowser().peekState() });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "getState failed",
    });
  }
}

export async function handleBrowserViewport(request: Request): Promise<Response> {
  if (!currentBrowser().isAvailable()) {
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
    await currentBrowser().setViewport(width, height);
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
