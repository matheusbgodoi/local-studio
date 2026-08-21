//
// The model capability contract the durable runtime consumes.
//
// Everything the scheduler and the context budget need to know about the
// serving model is read from the wire record the gateway publishes
// (`/v1/models` -> `AgentModel`). No alias, window size or inference strategy
// is named here: a 32K model, a 176128 model and a future 1M model differ only
// in the numbers this record carries, and speculative decoding (MTP, DFlash,
// ngram) is invisible to a token budget.
//

import type { AgentModel } from "../../../../shared/agent/models";

export type AgenticCapability = {
  modelId: string;
  physicalModelId: string;
  behaviorProfile: string | null;
  behaviorProfileLabel: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
  tools: boolean;
  vision: boolean;
  contextWindowDeclared: boolean;
};

const MIN_CONTEXT_WINDOW = 2048;
const MIN_OUTPUT_TOKENS = 256;

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const trimmedOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export function resolveAgenticCapability(model: AgentModel): AgenticCapability {
  const contextWindow = Math.max(
    MIN_CONTEXT_WINDOW,
    positiveInt(model.contextWindow, MIN_CONTEXT_WINDOW),
  );
  const maxOutputTokens = Math.min(
    contextWindow,
    Math.max(MIN_OUTPUT_TOKENS, positiveInt(model.maxTokens, MIN_OUTPUT_TOKENS)),
  );
  return {
    modelId: model.id,
    physicalModelId: trimmedOrNull(model.physicalModelId) ?? model.id,
    behaviorProfile: trimmedOrNull(model.behaviorProfile),
    behaviorProfileLabel: trimmedOrNull(model.behaviorProfileLabel),
    contextWindow,
    maxOutputTokens,
    reasoning: model.reasoning === true || model.nativeReasoning === true,
    tools: model.tools === true,
    vision: model.vision === true || model.visionDeclared === true,
    contextWindowDeclared: typeof model.contextWindowDeclared === "number",
  };
}

//
// The window the live session reports outranks the catalogue: a backend that
// was restarted with a different `-c` is the authority on its own window, and
// the budget must follow it inside one Run without a redeploy.
//
export function withRuntimeContextWindow(
  capability: AgenticCapability,
  runtimeContextWindow: number | null | undefined,
): AgenticCapability {
  const observed = Number(runtimeContextWindow);
  if (!Number.isFinite(observed) || observed < MIN_CONTEXT_WINDOW) return capability;
  const contextWindow = Math.floor(observed);
  if (contextWindow === capability.contextWindow) return capability;
  return {
    ...capability,
    contextWindow,
    maxOutputTokens: Math.min(capability.maxOutputTokens, contextWindow),
    contextWindowDeclared: true,
  };
}

export function capabilityIdentity(capability: AgenticCapability): string {
  return [capability.physicalModelId, capability.behaviorProfile ?? "-"].join("::");
}
