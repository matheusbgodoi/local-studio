import { describe, expect, test } from "bun:test";
// Relative on purpose: bun resolves no "@/" alias from this package.
import {
  declaredContextWindow,
  normalizeOpenAIModel,
} from "../../../shared/agent/models";

/**
 * THE DEFECT THIS PINS: a page whose whole claim is "only what the wire carried" was rendering
 * two things the wire never carried.
 *
 * AGENTS.md rule 5 forbids the client inferring a model's identity or capabilities from its
 * name. The Models page honours that for `tools`, which is read straight off the row — and then
 * broke it twice:
 *
 *   the vision chip   `AgentModel.vision` falls back to `inferModelVision`, which substring-
 *                     matches the alias against a 44-entry name table. An alias containing
 *                     "llama" or "gemma" earned a vision chip from its spelling.
 *   the context       `AgentModel.contextWindow` falls back to 128 000. The card tried to
 *                     suppress that with its own `typeof value === "number"` check, and the two
 *                     predicates disagreed in BOTH directions: `{context_window: 0}` counted as
 *                     declared, so the card showed "128,000 ctx" as though the server had said
 *                     it, while `{max_model_len: "32768"}` counted as undeclared, so a context
 *                     the resolver honours was silently dropped. 0 and -1 are the ordinary
 *                     encodings for "unknown"/"unlimited" — precisely the case that must not
 *                     produce a confident number.
 *
 * The fix is one predicate, exported, with the fallback layered on top of it rather than
 * re-implemented beside it.
 */

describe("the declared context window is not the resolved one", () => {
  test("a row that declares nothing declares nothing — and still resolves to the fallback", () => {
    const row = { id: "plain" };
    expect(declaredContextWindow(row)).toBeUndefined();
    // The fallback still exists for consumers that need *a* number; it is simply not
    // mistakable for something the backend said.
    expect(normalizeOpenAIModel(row).contextWindow).toBe(128_000);
    expect(normalizeOpenAIModel(row).contextWindowDeclared).toBeUndefined();
  });

  test("0 and -1 are not declarations — the exact case that showed 128,000 as fact", () => {
    for (const row of [
      { id: "a", context_window: 0 },
      { id: "b", max_model_len: -1 },
      { id: "c", meta: { context_window: 0 } },
    ]) {
      expect(declaredContextWindow(row)).toBeUndefined();
      expect(normalizeOpenAIModel(row).contextWindowDeclared).toBeUndefined();
    }
  });

  test("a numeric string IS a declaration — the inverse mismatch, which dropped a real value", () => {
    const row = { id: "c", max_model_len: "32768" };
    expect(declaredContextWindow(row)).toBe(32768);
    expect(normalizeOpenAIModel(row).contextWindowDeclared).toBe(32768);
    // and it agrees with the resolver, which is the whole point of one predicate
    expect(normalizeOpenAIModel(row).contextWindow).toBe(32768);
  });

  test("declared and resolved agree wherever a value exists", () => {
    for (const row of [
      { id: "d", contextWindow: 176128 },
      { id: "e", context_window: 131072 },
      { id: "f", meta: { max_model_len: 196608 } },
      { id: "g", metadata: { contextWindow: 65536 } },
    ]) {
      const model = normalizeOpenAIModel(row);
      expect(model.contextWindowDeclared).toBe(declaredContextWindow(row));
      expect(model.contextWindow).toBe(model.contextWindowDeclared!);
    }
  });
});

describe("vision the backend stated, vs vision guessed from the name", () => {
  test("a name that merely LOOKS multimodal declares nothing", () => {
    // These are the exact shapes that earned a chip from the 44-entry table.
    for (const id of ["my-vision-helper", "llama-4-scout", "gemma-4-writer"]) {
      const model = normalizeOpenAIModel({ id, meta: {} });
      expect(model.visionDeclared).toBeUndefined();
    }
  });

  test("the inferring field still infers — it answers a different question", () => {
    // `vision` decides whether to offer an image attachment, where a guess beats nothing.
    // This test exists so that a future change cannot quietly make them the same field again.
    const guessed = normalizeOpenAIModel({ id: "llama-4-scout", meta: {} });
    expect(guessed.vision).toBe(true);
    expect(guessed.visionDeclared).toBeUndefined();
    expect(guessed.vision).not.toBe(guessed.visionDeclared);
  });

  test("a backend that says so, in either key style, is believed", () => {
    expect(normalizeOpenAIModel({ id: "x", meta: { vision: true } }).visionDeclared).toBe(true);
    expect(normalizeOpenAIModel({ id: "y", metadata: { vision: true } }).visionDeclared).toBe(
      true,
    );
  });

  test("a backend that says NO is believed too, over any name-based guess", () => {
    // The interesting direction: the table would say true, the wire says false, wire wins.
    const stated = normalizeOpenAIModel({ id: "llama-4-scout", meta: { vision: false } });
    expect(stated.visionDeclared).toBe(false);
  });

  test("the live rig's rows: qwen-daily declares vision, and does not have to be named to", () => {
    const row = {
      id: "qwen-daily",
      meta: {
        physicalModelId: "qwen-daily",
        vision: true,
        tools: true,
        contextWindow: 176128,
        behaviorProfileDefault: true,
      },
    };
    const model = normalizeOpenAIModel(row);
    expect(model.visionDeclared).toBe(true);
    expect(model.tools).toBe(true);
    expect(model.contextWindowDeclared).toBe(176128);
  });
});
