import { expect, test } from "bun:test";
import { compact, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import {
  compactWithHeadroom,
  createBoundedCompactionExtension,
  type BoundedCompactionInput,
} from "../src/bounded-compaction";

type Model = BoundedCompactionInput["model"];
const model: Model = {
  id: "offline",
  name: "offline",
  api: "openai-completions",
  provider: "offline",
  baseUrl: "http://127.0.0.1:1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 8192,
};
const original = `NONCE_GOAL ${"word ".repeat(8000)} NONCE_DECISION ${"word ".repeat(8000)} NONCE_PENDING`;
const preparation = (): BoundedCompactionInput["preparation"] => ({
  firstKeptEntryId: "keep-recent",
  messagesToSummarize: [
    { role: "user", content: [{ type: "text", text: original }], timestamp: 1 },
  ],
  turnPrefixMessages: [],
  isSplitTurn: false,
  tokensBefore: 40000,
  previousSummary: "NONCE_PRIOR",
  fileOps: { read: new Set(["README.md"]), written: new Set(), edited: new Set(["src/task.ts"]) },
  settings: { enabled: true, reserveTokens: 8192, keepRecentTokens: 2000 },
});

function backend(mode: "bounded" | "overflow" | "truncated" = "bounded") {
  const accepted: number[] = [];
  let calls = 0;
  const stream: BoundedCompactionInput["stream"] = (_model, context, options) => {
    calls += 1;
    const text = context.messages
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
      )
      .join("\n");
    const tokens = text.length + (context.systemPrompt?.length ?? 0);
    const failed = mode === "overflow" || tokens + (options?.maxTokens ?? 0) > model.contextWindow;
    const content = [...new Set(text.match(/NONCE_[A-Z]+/g) ?? [])].join(" ");
    const message: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: "text", text: content || "summary" }],
      timestamp: 2,
      stopReason: failed ? "error" : mode === "truncated" ? "length" : "stop",
      ...(failed ? { errorMessage: "prompt is too long" } : {}),
      usage: {
        input: failed ? 0 : tokens,
        output: failed ? 0 : 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: failed ? 0 : tokens + 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const result = createAssistantMessageEventStream();
    if (failed) result.push({ type: "error", reason: "error", error: message });
    else {
      accepted.push(tokens + (options?.maxTokens ?? 0));
      result.push({ type: "done", reason: mode === "truncated" ? "length" : "stop", message });
    }
    return result;
  };
  return { stream, accepted, calls: () => calls };
}

const input = (stream: BoundedCompactionInput["stream"]): BoundedCompactionInput => ({
  preparation: preparation(),
  model,
  stream,
  signal: new AbortController().signal,
  retry: { enabled: false },
  notify: () => {},
});

test("the installed SDK whole-history summarizer overflows, staged fallback preserves nonce goals and recent boundary", async () => {
  const source = preparation();
  const before = JSON.stringify(source);
  const baseline = backend();
  await expect(
    compact(
      source,
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      baseline.stream,
      undefined,
      { enabled: false },
    ),
  ).rejects.toThrow("prompt is too long");
  const staged = backend();
  const result = await compactWithHeadroom({ ...input(staged.stream), preparation: source });
  for (const nonce of ["NONCE_GOAL", "NONCE_DECISION", "NONCE_PENDING", "NONCE_PRIOR"])
    expect(result.summary).toContain(nonce);
  expect(result.firstKeptEntryId).toBe("keep-recent");
  expect(result.summary).toContain("src/task.ts");
  expect(JSON.stringify(source)).toBe(before);
  expect(staged.accepted.length).toBeGreaterThan(1);
  expect(staged.accepted.every((tokens) => tokens <= model.contextWindow)).toBe(true);
  expect(staged.calls()).toBeLessThanOrEqual(32);
  expect(result.usage?.input).toBeGreaterThan(0);
});

test("persistent overflow stops boundedly without producing a partial compaction", async () => {
  const failing = backend("overflow");
  await expect(compactWithHeadroom(input(failing.stream))).rejects.toThrow(
    "Original context was retained",
  );
  expect(failing.calls()).toBeLessThanOrEqual(32);
});

test("cancellation performs no summarization and truncated output is never accepted", async () => {
  const stopped = backend();
  const controller = new AbortController();
  controller.abort();
  await expect(
    compactWithHeadroom({ ...input(stopped.stream), signal: controller.signal }),
  ).rejects.toThrow();
  expect(stopped.calls()).toBe(0);
  await expect(compactWithHeadroom(input(backend("truncated").stream))).rejects.toThrow(
    "output limit",
  );
});

test("extension returns cancellation on failure so SDK cannot silently retry the original oversized request", async () => {
  let handler: ((event: unknown, context: unknown) => Promise<unknown>) | undefined;
  const api = {
    on: (_event: string, callback: typeof handler) => {
      handler = callback;
    },
  } as unknown as ExtensionAPI;
  const notices: string[] = [];
  createBoundedCompactionExtension(() => {
    throw new Error("unavailable session");
  })(api);
  expect(
    await handler?.(
      { signal: new AbortController().signal },
      { model, ui: { notify: (message: string) => notices.push(message) } },
    ),
  ).toEqual({ cancel: true });
  expect(notices).toEqual(["unavailable session"]);
});

test("a transcript requiring too many segments stops after at most 32 backend requests", async () => {
  const bounded = backend();
  const source = preparation();
  source.messagesToSummarize = [
    { role: "user", content: [{ type: "text", text: "word ".repeat(400000) }], timestamp: 1 },
  ];
  await expect(
    compactWithHeadroom({ ...input(bounded.stream), preparation: source }),
  ).rejects.toThrow("bounded request limit");
  expect(bounded.calls()).toBeLessThanOrEqual(32);
});
