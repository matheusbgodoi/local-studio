import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const BROWSER_SESSION_ID = process.env.LOCAL_STUDIO_BROWSER_SESSION_ID ?? "";
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 60_000;

function readTimeoutMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const BROWSER_TOOL_TIMEOUT_MS = readTimeoutMs(
  "LOCAL_STUDIO_BROWSER_TOOL_TIMEOUT_MS",
  DEFAULT_BROWSER_TOOL_TIMEOUT_MS,
);

function failedToolResult(
  verb: string,
  payload: Record<string, unknown>,
  error: unknown,
): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `browser_${verb} failed: ${message}` }],
    details: { verb, payload, error: message, failed: true },
  };
}

async function callBrowserAction(
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BROWSER_TOOL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const response = await fetch(`${FRONTEND_BASE}/api/agent/browser/${verb}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      BROWSER_SESSION_ID ? { ...payload, sessionId: BROWSER_SESSION_ID } : payload,
    ),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${errBody}`);
  }
  const result = (await response.json()) as { ok: boolean; data?: unknown; error?: string };
  if (!result.ok) throw new Error(result.error || "browser bridge returned ok=false");
  const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);
  return {
    content: [{ type: "text", text }],
    details: { verb, payload, data: result.data },
  };
}

async function safeBrowserAction(
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  try {
    return await callBrowserAction(verb, payload, signal);
  } catch (error) {
    return failedToolResult(verb, payload, error);
  }
}

export default function registerBrowserExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_search",
    label: "Browser: Web Search",
    description:
      "Search the public web and return ranked results (title, url, domain, snippet). Discovery only - it does not open or read the pages. Pick the strongest one to three results and read them with browser_navigate + browser_get_text.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query. Precise phrasing beats a long sentence." }),
      maxResults: Type.Optional(
        Type.Number({ description: "How many results to return (default 8, maximum 15)" }),
      ),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction(
        "search",
        params.maxResults === undefined
          ? { query: params.query }
          : { query: params.query, maxResults: params.maxResults },
        signal,
      );
    },
  });

  pi.registerTool({
    name: "browser_verify",
    label: "Browser: Human Verification",
    description:
      "Open a visible browser window on the same session so the user can complete a CAPTCHA, security check or sign-in by hand. Call this only after a tool reported verificationRequired. Nothing is solved automatically; after the user finishes, read the page again.",
    parameters: Type.Object({
      url: Type.Optional(
        Type.String({ description: "Page needing verification; defaults to the current page" }),
      ),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("verify", params.url ? { url: params.url } : {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_navigate",
    label: "Browser: Navigate",
    description:
      "Navigate the embedded browser to a URL. Use this to open a webpage before reading or interacting with it.",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute http(s) URL to load" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("navigate", { url: params.url }, signal);
    },
  });

  pi.registerTool({
    name: "browser_get_url",
    label: "Browser: Current URL",
    description: "Return the current URL of the embedded browser.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("get-url", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_get_text",
    label: "Browser: Get Text",
    description:
      "Return the visible text of the current page (innerText of <body>). Use after navigating to read page contents.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("get-text", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_get_html",
    label: "Browser: Get HTML",
    description:
      "Return the rendered HTML of the current page. Useful when text alone isn't enough.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("get-html", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser: Screenshot",
    description: "Capture a PNG screenshot of the current page; returns a base64 data URI.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("screenshot", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser: Click",
    description: "Click an element matching a CSS selector. Returns whether the element was found.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the element to click" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("click", { selector: params.selector }, signal);
    },
  });

  pi.registerTool({
    name: "browser_scroll",
    label: "Browser: Scroll",
    description: "Scroll the page by a vertical pixel delta (positive = down).",
    parameters: Type.Object({
      deltaY: Type.Number({ description: "Pixels to scroll vertically" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("scroll", { deltaY: params.deltaY }, signal);
    },
  });

  pi.registerTool({
    name: "browser_fill",
    label: "Browser: Fill Field",
    description:
      "Set the value of an input/textarea matching a CSS selector and dispatch input/change events.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the input/textarea" }),
      value: Type.String({ description: "Value to set" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("fill", { selector: params.selector, value: params.value }, signal);
    },
  });
}
