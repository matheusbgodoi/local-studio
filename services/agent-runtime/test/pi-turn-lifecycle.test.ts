import { describe, expect, test } from "bun:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import { shouldRecoverByCompaction } from "../../../shared/agent/context-headroom";
import { observePiTurn } from "../src/pi-turn-lifecycle";

const model: Model<"openai-completions"> = {
  id: "offline",
  name: "offline",
  api: "openai-completions",
  provider: "offline",
  baseUrl: "http://127.0.0.1:1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200704,
  maxTokens: 32768,
};

function backend(failures: number) {
  let attempts = 0;
  return new Agent({
    initialState: { model },
    streamFn: () => {
      if (attempts++ < failures) throw new Error("Request timed out");
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: [{ type: "text", text: "completed" }],
          stopReason: "stop",
          timestamp: Date.now(),
          usage: {
            input: 10,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 11,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      });
      return stream;
    },
  });
}

describe("Pi terminal inference failures", () => {
  test("the installed SDK resolves an inference error that the runtime must propagate", async () => {
    const agent = backend(2);
    await expect(agent.prompt("first request")).resolves.toBeUndefined();
    expect(agent.state.messages.at(-1)?.role).toBe("assistant");
    await expect(observePiTurn(agent, () => agent.prompt("second request"))).rejects.toThrow(
      "Request timed out",
    );
  });

  test("a successful SDK continuation supersedes an earlier failed attempt", async () => {
    const agent = backend(1);
    await expect(
      observePiTurn(agent, async () => {
        await agent.prompt("original request");
        agent.state.messages = agent.state.messages.slice(0, -1);
        await agent.continue();
      }),
    ).resolves.toBeUndefined();
    expect(agent.state.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(agent.state.messages.at(-1)?.content).toEqual([{ type: "text", text: "completed" }]);
  });

  test("preflight rejection is preserved without requiring an assistant event", async () => {
    const agent = backend(0);
    await expect(
      observePiTurn(agent, () => Promise.reject(new Error("missing credentials"))),
    ).rejects.toThrow("missing credentials");
  });

  test("an operation without a new assistant does not reuse an old failure", async () => {
    const agent = backend(1);
    await agent.prompt("failed request");
    await expect(observePiTurn(agent, () => Promise.resolve())).resolves.toBeUndefined();
  });
});

describe("context recovery eligibility", () => {
  test("transport loss with unknown or small context does not trigger summarization", () => {
    expect(shouldRecoverByCompaction("Request timed out", null, 200704)).toBe(false);
    expect(shouldRecoverByCompaction("Request timed out", 1000, 200704)).toBe(false);
    expect(shouldRecoverByCompaction("Request timed out", 160000, 200704)).toBe(true);
  });

  test("explicit overflow can recover even when the preceding usage was small", () => {
    expect(shouldRecoverByCompaction("prompt is too long", 1000, 200704)).toBe(true);
    expect(shouldRecoverByCompaction("context_length_exceeded", null, null)).toBe(true);
  });

  test("deliberate cancellation never triggers recovery", () => {
    expect(
      shouldRecoverByCompaction("Request timed out; operation was aborted", 190000, 200704),
    ).toBe(false);
  });
});
