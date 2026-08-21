import type { AgentThinkingLevel } from "@/features/agent/contracts";
import type { AgentModelSelection } from "@shared/agent/models";

// The level a session runs at. There is deliberately no global "last level
// picked" any more: a level belongs to the model that can honour it, so the
// remembered fallback comes from the per-model store in
// workspace/thinking-level-preference.ts. A single global default is what used
// to carry a reasoning model's level onto a model that cannot think.

/** Resolve the level a session should use: its own saved choice wins, otherwise
 *  the level remembered for the model in hand, then "high", then the first level
 *  the model supports. Pure so it can be unit-tested without a DOM. */
export function pickThinkingLevel(
  levels: readonly AgentThinkingLevel[],
  saved: AgentThinkingLevel | undefined,
  preferred: AgentThinkingLevel | undefined,
): AgentThinkingLevel {
  if (saved && levels.includes(saved)) return saved;
  if (preferred && levels.includes(preferred)) return preferred;
  if (levels.includes("high")) return "high";
  // levels[0], not levels.at(-1): where a model has no "high" the last entry is
  // its MAXIMUM effort, and opening every fresh session at maximum thinking is
  // the most expensive possible default. The first entry is Off wherever Off is
  // offered.
  return levels[0] ?? "off";
}

/**
 * The level a pane runs at after the model picker was used, and whether that
 * level is a preference worth filing under the id just picked.
 *
 * A THINKING LEVEL BELONGS TO THE CHECKPOINT, NOT TO THE ALIAS. Levels are filed
 * per model id, and two behaviour profiles of one model are two keys, so
 * adopting the picked alias's remembered level on every pick meant Standard ->
 * Uncensored — same weights, same llama-server, same reasoning contract, a
 * different LoRA scale — silently reset a pane from XHigh to Off, the
 * never-written default of a key that names a behaviour rather than a model.
 * `changed` still adopts, so no model inherits the level of the model it
 * replaced.
 *
 * The carried level is still clamped, because two profiles are only guaranteed
 * one ladder while both draw it from the same physical model: `nativeReasoning`
 * is a per-row wire field and it short-circuits the contract before the
 * checkpoint is consulted, so a gateway can declare a pair that disagrees. A
 * level the target cannot honour falls through to that alias's own memory
 * instead of being invented.
 */
export function thinkingAfterModelSelection(
  selection: AgentModelSelection,
  levels: readonly AgentThinkingLevel[],
  remembered: AgentThinkingLevel,
): { level: AgentThinkingLevel; remember: boolean } {
  if (selection.physicalModel === "changed") return { level: remembered, remember: false };
  return {
    level: pickThinkingLevel(levels, selection.thinkingLevel, remembered),
    // The caller must file this itself: persistThinkingLevelByModel only writes a
    // level that CHANGED, by design, so that a session merely switching model
    // files nothing. A carried level did not change, so nothing downstream would
    // ever write it and the effort would come back one switch later.
    remember: true,
  };
}
