import type { AgentThinkingLevel } from "@/features/agent/contracts";

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
