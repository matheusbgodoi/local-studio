import type { AgentThinkingLevel } from "@/features/agent/contracts";

// The thinking level a model was last used at, remembered PER MODEL — same
// shape as model-preference.ts: one localStorage key, pure helpers over an
// injected Storage so the ephemeral workspace can hand in memory storage and
// tests can hand in a stub.
//
// Per model rather than global because a level belongs to the model that can
// honour it: qwen-daily speaks Off/Low/Medium/XHigh, gemma-write does not think
// at all. A single remembered level would carry one model's choice onto the
// next model the user opens.
const MODEL_THINKING_LEVELS_KEY = "local-studio.agent.thinkingLevelByModel";

/** A model with nothing saved starts at Off — never at another model's level. */
export const DEFAULT_MODEL_THINKING_LEVEL: AgentThinkingLevel = "off";

// Exhaustive by construction: this fails to compile if the shared thinking
// level contract ever gains or loses a level.
const THINKING_LEVELS: Record<AgentThinkingLevel, true> = {
  off: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
};

function isThinkingLevel(value: unknown): value is AgentThinkingLevel {
  return typeof value === "string" && Object.hasOwn(THINKING_LEVELS, value);
}

function readLevelsByModel(
  storage: Pick<Storage, "getItem">,
): Partial<Record<string, AgentThinkingLevel>> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(MODEL_THINKING_LEVELS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const levels: Partial<Record<string, AgentThinkingLevel>> = {};
    for (const [modelId, level] of Object.entries(parsed)) {
      if (modelId && isThinkingLevel(level)) levels[modelId] = level;
    }
    return levels;
  } catch {
    return {};
  }
}

/** The level remembered for `modelId`, or Off when that model never had one. */
export function readModelThinkingLevel(
  storage: Pick<Storage, "getItem">,
  modelId: string,
): AgentThinkingLevel {
  const key = modelId.trim();
  if (!key) return DEFAULT_MODEL_THINKING_LEVEL;
  return readLevelsByModel(storage)[key] ?? DEFAULT_MODEL_THINKING_LEVEL;
}

/** Remember `level` for `modelId` alone. Every other model keeps its own. */
export function writeModelThinkingLevel(
  storage: Pick<Storage, "getItem" | "setItem">,
  modelId: string,
  level: AgentThinkingLevel,
): void {
  const key = modelId.trim();
  if (!key) return;
  const levels = readLevelsByModel(storage);
  if (levels[key] === level) return;
  try {
    storage.setItem(MODEL_THINKING_LEVELS_KEY, JSON.stringify({ ...levels, [key]: level }));
  } catch {
    /* ignore storage failures — persistence here is a convenience, not load-bearing */
  }
}

/** Real storage in the browser, an inert stub on the server and wherever storage
 *  is unavailable — so callers in render paths need no `typeof window` dance and
 *  a blocked storage degrades to "nothing remembered" instead of throwing. */
export function browserThinkingStorage(): Pick<Storage, "getItem" | "setItem"> {
  if (typeof window === "undefined") return { getItem: () => null, setItem: () => {} };
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}
