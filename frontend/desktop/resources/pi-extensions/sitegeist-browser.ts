import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

type RelayResponse = { result?: unknown; error?: { code?: number; message?: string } };

const DEFAULT_RELAY_URL = "http://127.0.0.1:7717";
const DEFAULT_TIMEOUT_MS = 120_000;

type RelayConfig = { url: string; token: string; sessionId: string; timeoutMs: number };

function relayConfig(): RelayConfig {
  const value = Number(process.env.SITEGEIST_RELAY_TOOL_TIMEOUT_MS);
  return {
    url: (process.env.SITEGEIST_RELAY_URL || DEFAULT_RELAY_URL).replace(/\/+$/, ""),
    token: process.env.SITEGEIST_RELAY_TOKEN ?? "",
    sessionId:
      process.env.SITEGEIST_RELAY_SESSION_ID ||
      process.env.LOCAL_STUDIO_BROWSER_SESSION_ID ||
      "default",
    timeoutMs: Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_TIMEOUT_MS,
  };
}

async function callRelay(
  config: RelayConfig,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sitegeist-Session": config.sessionId,
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  try {
    const response = await fetch(`${config.url}/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => ({}))) as RelayResponse;
    if (!response.ok || body.error) {
      throw new Error(body.error?.message || `sitegeist relay HTTP ${response.status}`);
    }
    return body.result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

type ToolDef<S extends TSchema> = {
  name: string;
  method: string;
  label: string;
  description: string;
  parameters: S;
  pick: (params: Static<S>) => Record<string, unknown>;
};

function define<S extends TSchema>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
}

const url = Type.String({ description: "Absolute http(s) URL" });
const optionalSelector = Type.Optional(Type.String({ description: "Optional CSS selector" }));
const tabId = Type.Union([Type.String(), Type.Number()], { description: "Tab id" });

const TOOLS = [
  define({
    name: "sitegeist_navigate",
    method: "browser.navigate",
    label: "Sitegeist: Navigate",
    description: "Navigate the sitegeist browser to an absolute http(s) URL.",
    parameters: Type.Object({ url }),
    pick: (p) => ({ url: p.url }),
  }),
  define({
    name: "sitegeist_get_url",
    method: "browser.url",
    label: "Sitegeist: Current URL",
    description: "Return the current URL and title from the sitegeist browser.",
    parameters: Type.Object({}),
    pick: () => ({}),
  }),
  define({
    name: "sitegeist_get_text",
    method: "browser.text",
    label: "Sitegeist: Get Text",
    description: "Return visible page text, optionally scoped to a selector.",
    parameters: Type.Object({ selector: optionalSelector }),
    pick: (p) => compact({ selector: p.selector }),
  }),
  define({
    name: "sitegeist_get_html",
    method: "browser.html",
    label: "Sitegeist: Get HTML",
    description: "Return rendered HTML, optionally scoped to a selector.",
    parameters: Type.Object({ selector: optionalSelector }),
    pick: (p) => compact({ selector: p.selector }),
  }),
  define({
    name: "sitegeist_screenshot",
    method: "browser.screenshot",
    label: "Sitegeist: Screenshot",
    description: "Capture a PNG screenshot of the page or an element.",
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean({ description: "Capture the full scrollable page" })),
      selector: optionalSelector,
    }),
    pick: (p) => compact({ fullPage: p.fullPage, selector: p.selector }),
  }),
  define({
    name: "sitegeist_click",
    method: "browser.click",
    label: "Sitegeist: Click",
    description: "Click a selector, or a viewport coordinate when no selector is given.",
    parameters: Type.Object({
      selector: optionalSelector,
      x: Type.Optional(Type.Number({ description: "Viewport x coordinate" })),
      y: Type.Optional(Type.Number({ description: "Viewport y coordinate" })),
    }),
    pick: (p) => compact({ selector: p.selector, x: p.x, y: p.y }),
  }),
  define({
    name: "sitegeist_fill",
    method: "browser.fill",
    label: "Sitegeist: Fill Field",
    description: "Set a form field value, optionally submitting the form afterward.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of the field" }),
      value: Type.String({ description: "Value to set" }),
      submit: Type.Optional(Type.Boolean({ description: "Submit the form after filling" })),
    }),
    pick: (p) => compact({ selector: p.selector, value: p.value, submit: p.submit }),
  }),
  define({
    name: "sitegeist_scroll",
    method: "browser.scroll",
    label: "Sitegeist: Scroll",
    description: "Scroll the page or an element by a pixel delta.",
    parameters: Type.Object({
      dx: Type.Optional(Type.Number({ description: "Horizontal pixels" })),
      dy: Type.Optional(Type.Number({ description: "Vertical pixels" })),
      selector: optionalSelector,
    }),
    pick: (p) => compact({ dx: p.dx, dy: p.dy, selector: p.selector }),
  }),
  define({
    name: "sitegeist_eval",
    method: "browser.eval",
    label: "Sitegeist: Evaluate",
    description: "Evaluate a JavaScript expression in the page context and return the value.",
    parameters: Type.Object({
      expression: Type.String({ description: "JavaScript expression to evaluate" }),
    }),
    pick: (p) => ({ expression: p.expression }),
  }),
  define({
    name: "sitegeist_tabs_list",
    method: "browser.tabs.list",
    label: "Sitegeist: List Tabs",
    description: "List open tabs in the sitegeist browser session.",
    parameters: Type.Object({}),
    pick: () => ({}),
  }),
  define({
    name: "sitegeist_tabs_new",
    method: "browser.tabs.new",
    label: "Sitegeist: New Tab",
    description: "Open a new tab, optionally loading a URL.",
    parameters: Type.Object({ url: Type.Optional(url) }),
    pick: (p) => compact({ url: p.url }),
  }),
  define({
    name: "sitegeist_tabs_switch",
    method: "browser.tabs.switch",
    label: "Sitegeist: Switch Tab",
    description: "Switch the active tab by id.",
    parameters: Type.Object({ id: tabId }),
    pick: (p) => ({ id: p.id }),
  }),
  define({
    name: "sitegeist_tabs_close",
    method: "browser.tabs.close",
    label: "Sitegeist: Close Tab",
    description: "Close a tab by id.",
    parameters: Type.Object({ id: tabId }),
    pick: (p) => ({ id: p.id }),
  }),
] as const;

async function runTool(
  config: RelayConfig,
  name: string,
  method: string,
  params: Record<string, unknown>,
  rpcParams: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  try {
    const result = await callRelay(config, method, rpcParams, signal);
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return {
      content: [{ type: "text", text }],
      details: { method, params, data: result, relaySessionId: config.sessionId },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `${name} failed: ${message}` }],
      details: { method, params, error: message, failed: true },
    };
  }
}

async function relayCapabilities(config: RelayConfig): Promise<Set<string> | null> {
  try {
    const controller = new AbortController();
    const result = await callRelay(config, "relay.capabilities", {}, controller.signal);
    const methods = (result as { methods?: unknown })?.methods;
    return Array.isArray(methods)
      ? new Set(methods.filter((m): m is string => typeof m === "string"))
      : null;
  } catch {
    return null;
  }
}

export default async function registerSitegeistBrowserExtension(pi: ExtensionAPI) {
  const config = relayConfig();

  const supported = await relayCapabilities(config);

  for (const tool of TOOLS) {
    if (supported && !supported.has(tool.method)) continue;
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      execute(_id, params, signal) {
        const args = params as Record<string, unknown>;
        return runTool(config, tool.name, tool.method, args, tool.pick(params as never), signal);
      },
    });
  }
}
