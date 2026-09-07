import { expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { contextUsageIsMeasured } from "../src/context-usage-provenance";
import { resolveContextReading } from "../src/agentic/scheduler-session";

const assistant: AgentSession["messages"][number] = {
  role: "assistant",
  api: "openai-completions",
  provider: "offline",
  model: "offline",
  content: [{ type: "text", text: "done" }],
  timestamp: 0,
  stopReason: "stop",
  usage: {
    input: 100,
    output: 10,
    cacheRead: 20,
    cacheWrite: 0,
    totalTokens: 130,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

test("completed backend usage is measured only with no trailing payload", () => {
  expect(contextUsageIsMeasured(130, [assistant])).toBe(true);
  expect(
    contextUsageIsMeasured(160, [
      assistant,
      { role: "user", content: "trailing archive", timestamp: 1 },
    ]),
  ).toBe(false);
  expect(
    contextUsageIsMeasured(130, [assistant, { role: "user", content: "", timestamp: 1 }]),
  ).toBe(false);
  expect(contextUsageIsMeasured(160, [assistant])).toBe(false);
});

test("compaction unknown usage and failed requests cannot borrow old measurement", () => {
  expect(contextUsageIsMeasured(null, [assistant])).toBe(false);
  expect(contextUsageIsMeasured(130, [{ ...assistant, stopReason: "error" }])).toBe(false);
  expect(contextUsageIsMeasured(130, [])).toBe(false);
});

test("scheduler preserves the exact conservative SDK count without calling another estimator", () => {
  const reading = resolveContextReading(
    161820,
    200704,
    () => {
      throw Error("must not recount");
    },
    false,
  );
  expect(reading).toEqual({ tokens: 161820, contextWindow: 200704, measured: false });
});
