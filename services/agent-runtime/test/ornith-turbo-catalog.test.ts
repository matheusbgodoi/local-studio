import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no "@/" alias from this package.
import {
  DEFAULT_AGENT_MODEL_KEY,
  readAndMigrateDefaultAgentModel,
  readDefaultAgentModel,
  writeDefaultAgentModel,
} from "../../../frontend/src/features/agent/workspace/model-preference";
import {
  declaredModelReasoning,
  isNativeAlwaysOnThinkingModelId,
  normalizeOpenAIModels,
} from "../../../shared/agent/models";
import { controllerModelThinkingLevels } from "../src/pi-runtime-models";

function memoryStorage(seed: Record<string, string> = {}) {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

describe("retired Turbo alias", () => {
  test("a workspace that remembered qwen-turbo opens on ornith-turbo", () => {
    const storage = memoryStorage({ [DEFAULT_AGENT_MODEL_KEY]: "qwen-turbo" });
    expect(readDefaultAgentModel(storage)).toBe("ornith-turbo");
  });

  test("the rewrite is persisted once, not applied on every read", () => {
    const storage = memoryStorage({ [DEFAULT_AGENT_MODEL_KEY]: "qwen-turbo" });
    expect(readAndMigrateDefaultAgentModel(storage)).toBe("ornith-turbo");
    expect(storage.entries.get(DEFAULT_AGENT_MODEL_KEY)).toBe("ornith-turbo");
    expect(readAndMigrateDefaultAgentModel(storage)).toBe("ornith-turbo");
  });

  test("no other remembered model is touched", () => {
    for (const id of ["qwen-daily", "gemma-write", "some-model-that-is-really-gone"]) {
      const storage = memoryStorage({ [DEFAULT_AGENT_MODEL_KEY]: id });
      expect(readAndMigrateDefaultAgentModel(storage)).toBe(id);
      expect(storage.entries.get(DEFAULT_AGENT_MODEL_KEY)).toBe(id);
    }
  });

  test("nothing remembered stays nothing - the migration invents no default", () => {
    const storage = memoryStorage();
    expect(readAndMigrateDefaultAgentModel(storage)).toBe("");
    expect(storage.entries.has(DEFAULT_AGENT_MODEL_KEY)).toBe(false);
  });

  test("writing still round-trips untouched", () => {
    const storage = memoryStorage();
    writeDefaultAgentModel(storage, "ornith-turbo");
    expect(readDefaultAgentModel(storage)).toBe("ornith-turbo");
  });
});

describe("ornith-turbo reasoning is native, not an effort ladder", () => {
  test("the alias is declared as always-on", () => {
    expect(declaredModelReasoning("ornith-turbo")?.thinkingContract).toBe("native-always-on");
    expect(isNativeAlwaysOnThinkingModelId("ornith-turbo")).toBe(true);
    expect(isNativeAlwaysOnThinkingModelId("qwen-daily")).toBe(false);
    expect(isNativeAlwaysOnThinkingModelId("gemma-write")).toBe(false);
  });

  test("qwen-uncensored is qwen-daily, so it declares the SAME contract", () => {
    // One GGUF, one llama-server, one chat template. If these two ever diverge,
    // one of them is describing a model that does not exist.
    expect(declaredModelReasoning("qwen-uncensored")).toEqual(
      declaredModelReasoning("qwen-daily"),
    );
    expect(isNativeAlwaysOnThinkingModelId("qwen-uncensored")).toBe(false);
    expect(controllerModelThinkingLevels(true, "qwen-uncensored")).toEqual(
      controllerModelThinkingLevels(true, "qwen-daily"),
    );
  });

  test("one fixed level, so the picker cannot offer a ladder the template ignores", () => {
    // The gateway reports reasoning:false for this alias - truthfully, about the
    // request contract. That must not collapse to "Off".
    expect(controllerModelThinkingLevels(false, "ornith-turbo")).toEqual(["high"]);
    expect(controllerModelThinkingLevels(true, "ornith-turbo")).toEqual(["high"]);
  });

  test("qwen-daily keeps its four real levels, gemma-write keeps none", () => {
    expect(controllerModelThinkingLevels(true, "qwen-daily")).toEqual([
      "off",
      "low",
      "medium",
      "xhigh",
    ]);
    expect(controllerModelThinkingLevels(false, "gemma-write")).toEqual(["off"]);
  });
});

describe("the catalogue the gateway advertises", () => {
  const payload = {
    data: [
      {
        id: "qwen-daily",
        metadata: { contextWindow: 149504, maxTokens: 32768, reasoning: true, vision: true },
      },
      {
        id: "ornith-turbo",
        metadata: {
          contextWindow: 196608,
          maxTokens: 32768,
          reasoning: false,
          nativeReasoning: true,
          tools: true,
          vision: true,
        },
      },
      {
        // The gateway clones this row from qwen-daily's, because it IS qwen-daily.
        id: "qwen-uncensored",
        metadata: { contextWindow: 149504, maxTokens: 32768, reasoning: true, vision: true },
      },
      {
        id: "gemma-write",
        metadata: { contextWindow: 131072, maxTokens: 32768, reasoning: false, vision: false },
      },
    ],
  };

  test("context windows come from the server, not from a client constant", () => {
    const byId = Object.fromEntries(normalizeOpenAIModels(payload).map((m) => [m.id, m]));
    expect(byId["ornith-turbo"].contextWindow).toBe(196608);
    expect(byId["qwen-daily"].contextWindow).toBe(149504);
    expect(byId["gemma-write"].contextWindow).toBe(131072);
    // Same server, same window. A client that shows two different numbers for one
    // model is lying about one of them.
    expect(byId["qwen-uncensored"].contextWindow).toBe(byId["qwen-daily"].contextWindow);
  });

  test("vision is on for both llama.cpp roles and off for the vLLM one", () => {
    const byId = Object.fromEntries(normalizeOpenAIModels(payload).map((m) => [m.id, m]));
    expect(byId["ornith-turbo"].vision).toBe(true);
    expect(byId["qwen-daily"].vision).toBe(true);
    expect(byId["gemma-write"].vision).toBe(false);
    expect(byId["qwen-uncensored"].vision).toBe(true);
  });
});
