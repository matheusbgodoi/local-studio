import { describe, expect, test } from "bun:test";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import type { AgentThinkingLevel } from "../../../shared/agent/agent-turn";
import {
  inferReasoningSupport,
  normalizeOpenAIModel,
  normalizeOpenAIModels,
  type AgentModel,
} from "../../../shared/agent/models";
import { controllerModelThinkingLevels, modelsToPiModels } from "../src/pi-runtime-models";

// Verbatim from the live controller's GET /v1/models. llama-swap files its
// extras under "meta", and that meta says nothing at all about reasoning — the
// reason the alias needs an explicit declaration rather than a payload flag.
const LIVE_LLAMA_SWAP_MODELS = {
  object: "list",
  data: [
    {
      id: "gemma-write",
      object: "model",
      created: 1787058099,
      owned_by: "llama-swap",
      name: "Gemma 4 26B-A4B (write)",
      meta: { llamaswap: { type: "model" } },
      status: { value: "unloaded" },
    },
    {
      id: "qwen-daily",
      object: "model",
      created: 1787058099,
      owned_by: "llama-swap",
      name: "Qwen3.8-27B (daily)",
      meta: { llamaswap: { type: "model" } },
      status: { value: "loaded" },
    },
    {
      id: "qwen-turbo",
      object: "model",
      created: 1787058099,
      owned_by: "llama-swap",
      name: "Qwen3.6-35B-A3B (turbo)",
      meta: { llamaswap: { type: "model" } },
      status: { value: "unloaded" },
    },
  ],
};

function agentModel(overrides: Partial<AgentModel> & { id: string }): AgentModel {
  return {
    name: overrides.id,
    provider: "local-studio",
    physicalModelId: overrides.id,
    contextWindow: 128_000,
    maxTokens: 65_536,
    reasoning: false,
    vision: false,
    active: false,
    ...overrides,
  };
}

function piModelFor(model: AgentModel) {
  const [piModel] = modelsToPiModels([model]);
  if (!piModel) throw new Error("modelsToPiModels returned nothing");
  return piModel;
}

describe("qwen-daily reasoning discovery", () => {
  test("the id heuristic still cannot see it — the declaration is what wins", () => {
    // Guard against 'fixing' this by teaching the substring heuristic a new
    // token: the alias hides the checkpoint, and it must stay hidden.
    expect(inferReasoningSupport("qwen-daily")).toBe(false);
    expect(normalizeOpenAIModel({ id: "qwen-daily" }).reasoning).toBe(true);
  });

  test("advertises reasoning from the live llama-swap payload", () => {
    const models = normalizeOpenAIModels(LIVE_LLAMA_SWAP_MODELS);
    const byId = new Map(models.map((model) => [model.id, model]));
    expect(byId.get("qwen-daily")?.reasoning).toBe(true);
    expect(byId.get("qwen-turbo")?.reasoning).toBe(false);
    expect(byId.get("gemma-write")?.reasoning).toBe(false);
  });

  test("reads controller extras from meta as well as metadata", () => {
    expect(normalizeOpenAIModel({ id: "mystery-model", meta: { reasoning: true } }).reasoning).toBe(
      true,
    );
    expect(
      normalizeOpenAIModel({ id: "mystery-model", metadata: { reasoning: true } }).reasoning,
    ).toBe(true);
    // A controller that speaks for itself outranks the declaration.
    expect(normalizeOpenAIModel({ id: "qwen-daily", meta: { reasoning: false } }).reasoning).toBe(
      false,
    );
  });

  test("declaring one alias does not make every model reason", () => {
    expect(normalizeOpenAIModel({ id: "qwen-turbo" }).reasoning).toBe(false);
    expect(normalizeOpenAIModel({ id: "gemma-write" }).reasoning).toBe(false);
    expect(normalizeOpenAIModel({ id: "some-random-model" }).reasoning).toBe(false);
  });
});

describe("qwen-daily thinking levels", () => {
  test("exposes exactly Off, Low, Medium and XHigh", () => {
    expect(controllerModelThinkingLevels(true, "qwen-daily")).toEqual([
      "off",
      "low",
      "medium",
      "xhigh",
    ]);
  });

  test("never exposes Minimal, High or Max, and never renames XHigh to Max", () => {
    const levels = controllerModelThinkingLevels(true, "qwen-daily");
    expect(levels).not.toContain("minimal");
    expect(levels).not.toContain("high");
    expect(levels).not.toContain("max");
    expect(levels).toContain("xhigh");
  });

  test("marks minimal, high and max unsupported in the pi contract", () => {
    const piModel = piModelFor(agentModel({ id: "qwen-daily", reasoning: true }));
    expect(piModel.thinkingLevelMap).toEqual({
      minimal: null,
      low: "low",
      medium: "medium",
      high: null,
      xhigh: "xhigh",
      max: null,
    });
  });

  test("carries the chat-template kwargs contract pi-ai builds the body from", () => {
    const piModel = piModelFor(agentModel({ id: "qwen-daily", reasoning: true }));
    expect(piModel.compat.thinkingFormat).toBe("chat-template");
    expect(piModel.compat.chatTemplateKwargs).toEqual({
      enable_thinking: { $var: "thinking.enabled" },
      reasoning_effort: { $var: "thinking.effort", omitWhenOff: true },
    });
    // The vLLM-flavoured base compat must survive alongside it.
    expect(piModel.compat.supportsReasoningEffort).toBe(true);
    expect(piModel.compat.maxTokensField).toBe("max_completion_tokens");
    expect(piModel.reasoning).toBe(true);
  });

  test("applies to the qualified id of a secondary controller too", () => {
    const piModel = piModelFor(
      agentModel({
        id: "local-studio-2/qwen-daily",
        rawId: "qwen-daily",
        reasoning: true,
      }),
    );
    expect(piModel.compat.thinkingFormat).toBe("chat-template");
  });
});

describe("models that genuinely do not reason", () => {
  test("stay at Off with no thinking contract attached", () => {
    for (const id of ["qwen-turbo", "gemma-write"]) {
      expect(controllerModelThinkingLevels(false, id)).toEqual(["off"]);
      const piModel = piModelFor(agentModel({ id, reasoning: false }));
      expect(piModel.thinkingLevelMap).toBeUndefined();
      expect(piModel.compat.thinkingFormat).toBeUndefined();
      expect(piModel.compat.chatTemplateKwargs).toBeUndefined();
      expect(piModel.reasoning).toBe(false);
    }
  });

  test("other reasoning families keep the contract they had", () => {
    expect(controllerModelThinkingLevels(true, "inkling-small")).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(controllerModelThinkingLevels(true, "some-reasoner")).toEqual(["high", "max"]);

    const deepSeek = piModelFor(
      agentModel({ id: "deepseek-r1", name: "DeepSeek R1", reasoning: true }),
    );
    expect(deepSeek.compat.thinkingFormat).toBe("deepseek");
    expect(deepSeek.compat.requiresReasoningContentOnAssistantMessages).toBe(true);
    expect(deepSeek.thinkingLevelMap?.xhigh).toBe("max");
  });
});

// The contract is DATA — pi-ai builds the request body from it. This asks pi-ai
// what it would actually put on the wire, via its public `onPayload` hook, so a
// change in either half is caught here rather than by the model going silent.
async function requestBodyFor(level: AgentThinkingLevel): Promise<Record<string, unknown>> {
  const [piModel] = modelsToPiModels([agentModel({ id: "qwen-daily", reasoning: true })]);
  if (!piModel) throw new Error("modelsToPiModels returned nothing");
  const model = {
    ...piModel,
    api: "openai-completions" as const,
    provider: "local-studio",
    baseUrl: "http://127.0.0.1:4000/v1",
    input: ["text" as const],
  };
  let payload: Record<string, unknown> = {};
  const events = stream(
    model,
    { messages: [{ role: "user", content: "hi" }] },
    {
      apiKey: "test",
      ...(level === "off" ? {} : { reasoningEffort: level }),
      onPayload: (body) => {
        payload = body as Record<string, unknown>;
        return undefined;
      },
      // No network: onPayload has already run by the time the request fails.
      fetch: () => Promise.reject(new Error("offline by design")),
    },
  );
  try {
    for await (const _event of events) void _event;
  } catch {
    /* expected */
  }
  return payload;
}

describe("what qwen-daily actually receives", () => {
  test("Off disables thinking and sends no effort at all", async () => {
    const body = await requestBodyFor("off");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.reasoning_effort).toBeUndefined();
  });

  test("Low, Medium and XHigh ride in chat_template_kwargs as themselves", async () => {
    for (const level of ["low", "medium", "xhigh"] as const) {
      const body = await requestBodyFor(level);
      expect(body.chat_template_kwargs).toEqual({
        enable_thinking: true,
        reasoning_effort: level,
      });
      // Samplers are the gateway's half of the deal; we send kwargs only.
      expect(body.reasoning_effort).toBeUndefined();
    }
  });

  test("an unsupported level can never smuggle an effort through", async () => {
    for (const level of ["minimal", "high", "max"] as const) {
      const body = await requestBodyFor(level);
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    }
  });
});
