import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no "@/" alias from this package, and the
// module under test is deliberately import-free at runtime so it can be
// exercised without a DOM.
import {
  DEFAULT_MODEL_THINKING_LEVEL,
  readModelThinkingLevel,
  writeModelThinkingLevel,
} from "../../../frontend/src/features/agent/workspace/thinking-level-preference";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

describe("per-model thinking level persistence", () => {
  test("a model that has never had a level saved starts at Off", () => {
    const storage = memoryStorage();
    expect(DEFAULT_MODEL_THINKING_LEVEL).toBe("off");
    expect(readModelThinkingLevel(storage, "qwen-daily")).toBe("off");
    expect(readModelThinkingLevel(storage, "gemma-write")).toBe("off");
  });

  test("set and get round-trip per model id", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, "qwen-daily", "xhigh");
    writeModelThinkingLevel(storage, "qwen-turbo", "low");
    writeModelThinkingLevel(storage, "gemma-write", "off");

    expect(readModelThinkingLevel(storage, "qwen-daily")).toBe("xhigh");
    expect(readModelThinkingLevel(storage, "qwen-turbo")).toBe("low");
    expect(readModelThinkingLevel(storage, "gemma-write")).toBe("off");
  });

  test("one model's level never bleeds into another", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, "qwen-daily", "xhigh");

    // A model that was never given a level answers Off, not XHigh.
    expect(readModelThinkingLevel(storage, "qwen-turbo")).toBe("off");
    expect(readModelThinkingLevel(storage, "gemma-write")).toBe("off");

    // Writing another model leaves the first one alone.
    writeModelThinkingLevel(storage, "qwen-turbo", "medium");
    expect(readModelThinkingLevel(storage, "qwen-daily")).toBe("xhigh");
    expect(readModelThinkingLevel(storage, "qwen-turbo")).toBe("medium");
  });

  test("switching away and back restores the previous level for that model", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, "qwen-daily", "xhigh");
    writeModelThinkingLevel(storage, "gemma-write", "off");
    // ...back to qwen-daily.
    expect(readModelThinkingLevel(storage, "qwen-daily")).toBe("xhigh");
  });

  test("survives a restart: everything lives in one storage key", () => {
    const first = memoryStorage();
    writeModelThinkingLevel(first, "qwen-daily", "medium");
    writeModelThinkingLevel(first, "qwen-turbo", "low");

    const restarted = memoryStorage();
    for (const [key, value] of first.entries) restarted.entries.set(key, value);

    expect(restarted.entries.size).toBe(1);
    expect(readModelThinkingLevel(restarted, "qwen-daily")).toBe("medium");
    expect(readModelThinkingLevel(restarted, "qwen-turbo")).toBe("low");
  });

  test("garbage in storage degrades to Off instead of throwing", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, "qwen-daily", "xhigh");
    const [key] = [...storage.entries.keys()];

    storage.entries.set(key ?? "", "not json");
    expect(readModelThinkingLevel(storage, "qwen-daily")).toBe("off");

    storage.entries.set(key ?? "", JSON.stringify({ "qwen-daily": "ludicrous" }));
    expect(readModelThinkingLevel(storage, "qwen-daily")).toBe("off");

    storage.entries.set(key ?? "", JSON.stringify(["qwen-daily", "xhigh"]));
    expect(readModelThinkingLevel(storage, "qwen-daily")).toBe("off");
  });

  test("an empty model id is never persisted or read", () => {
    const storage = memoryStorage();
    writeModelThinkingLevel(storage, "   ", "max");
    expect(storage.entries.size).toBe(0);
    expect(readModelThinkingLevel(storage, "")).toBe("off");
  });
});
