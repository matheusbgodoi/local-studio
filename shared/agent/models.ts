import {
  inferModelVision,
  resolveModelVision,
} from "../../controller/contracts/model-capabilities";
import type { AgentThinkingLevel } from "./agent-turn";
import { isRecord } from "./guards";

export interface OpenAIModelListItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  name?: string;
  context_window?: number;
  contextWindow?: number;
  max_model_len?: number;
  max_tokens?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  /** llama-swap's spelling of `metadata`. Its /v1/models rows carry their
   *  extras under `meta`, so reading only `metadata` threw them away. */
  meta?: Record<string, unknown>;
  active?: boolean;
  [key: string]: unknown;
}

export interface OpenAIModelsResponse {
  object?: string;
  data?: OpenAIModelListItem[];
}

export interface AgentModel {
  id: string;
  name: string;
  provider: "local-studio";
  providerId?: string;
  rawId?: string;
  controllerUrl?: string;
  controllerName?: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  thinkingLevels?: AgentThinkingLevel[];
  vision: boolean;
  active: boolean;
}

export function inferReasoningSupport(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return (
    normalized.includes("reason") ||
    normalized.includes("thinking") ||
    normalized.includes("r1") ||
    normalized.includes("deepseek") ||
    normalized.includes("inkling") ||
    normalized.includes("qwen3") ||
    normalized.includes("glm-5") ||
    normalized.includes("mimo")
  );
}

export type DeclaredModelReasoning = {
  reasoning: boolean;
  /** Wire contract the checkpoint's chat template speaks, when it is not the
   *  plain OpenAI `reasoning_effort` default. Consumed by the agent runtime. */
  thinkingContract?: "chat-template-effort";
};

/**
 * Reasoning contracts Local Studio declares itself, keyed by the exact
 * controller alias.
 *
 * The live llama-swap `/v1/models` rows carry only
 * `{ meta: { llamaswap: { type: "model" } } }` — no reasoning flag at all — and
 * the alias hides the checkpoint, so neither the payload nor
 * `inferReasoningSupport("qwen-daily")` can see the Qwen3 underneath. Declaring
 * the alias here keeps the alias intact and keeps the heuristic honest: only
 * ids listed here are affected, every other model still answers for itself.
 */
const DECLARED_MODEL_REASONING: Readonly<Record<string, DeclaredModelReasoning>> = {
  // Qwen3.8-27B behind llama-swap. Its chat template takes
  // chat_template_kwargs { enable_thinking, reasoning_effort: low|medium|xhigh }.
  "qwen-daily": { reasoning: true, thinkingContract: "chat-template-effort" },
};

/** Declared capabilities for `modelId`, or undefined when nothing is declared. */
export function declaredModelReasoning(modelId: string): DeclaredModelReasoning | undefined {
  return DECLARED_MODEL_REASONING[modelId.trim().toLowerCase()];
}

export function inferVisionSupport(modelId: string): boolean {
  return inferModelVision([modelId]);
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function firstNumber(values: unknown[], fallback: number): number {
  for (const value of values) {
    const parsed = numberFromUnknown(value);
    if (parsed) return parsed;
  }
  return fallback;
}

function resolveContextWindow(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
): number {
  return firstNumber(
    [
      model.contextWindow,
      model.context_window,
      model.max_model_len,
      metadata.contextWindow,
      metadata.context_window,
      metadata.max_model_len,
    ],
    128_000,
  );
}

function resolveMaxTokens(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
  contextWindow: number,
): number {
  return firstNumber(
    [model.maxTokens, model.max_tokens, metadata.maxTokens, metadata.max_tokens],
    Math.min(contextWindow, 65_536),
  );
}

function resolveReasoning(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
  id: string,
): boolean {
  const explicitReasoning = metadata.reasoning ?? model.reasoning;
  if (typeof explicitReasoning === "boolean") return explicitReasoning;
  // Explicit beats inferred: a declared alias is not up for guessing.
  return declaredModelReasoning(id)?.reasoning ?? inferReasoningSupport(id);
}

/** Extras a controller ships alongside the row. llama-swap uses `meta`, other
 *  OpenAI-compatible hosts use `metadata`; `metadata` wins where both exist. */
function modelExtras(model: OpenAIModelListItem): Record<string, unknown> {
  return { ...recordFromUnknown(model.meta), ...recordFromUnknown(model.metadata) };
}

export function normalizeOpenAIModel(model: OpenAIModelListItem): AgentModel {
  const metadata = modelExtras(model);
  const id = String(model.id || "").trim();
  const name = String(model.name || metadata.name || id).trim() || id;
  const contextWindow = resolveContextWindow(model, metadata);
  const maxTokens = resolveMaxTokens(model, metadata, contextWindow);
  const explicitActive = metadata.active ?? model.active;

  return {
    id,
    name,
    provider: "local-studio",
    contextWindow,
    maxTokens,
    reasoning: resolveReasoning(model, metadata, id),
    vision: resolveModelVision({
      identifiers: [id],
      metadata,
      modalities: [model.input, model.inputs, model.modalities],
    }),
    active: explicitActive === true,
  };
}

export function normalizeOpenAIModels(payload: OpenAIModelsResponse): AgentModel[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const seen = new Set<string>();
  const models: AgentModel[] = [];
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim()) continue;
    const model = normalizeOpenAIModel(row);
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}
