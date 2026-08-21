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
  /** Grouping key: the physical checkpoint this row is served from. Several
   *  aliases share one. Falls back to the row's own id when the server does not
   *  say, so a model that is its own physical model is a group of one. */
  physicalModelId: string;
  /** Which behaviour this alias IS, when the physical model serves more than
   *  one. Absent on a physical model with a single behaviour. */
  behaviorProfile?: string;
  behaviorProfileLabel?: string;
  /** Which profile a client lands on when it picks the PHYSICAL model without
   *  naming one. The server declares it on exactly one alias per multi-profile
   *  model, because the alternative — "whichever sorted first" — is an accident
   *  of naming, and on the live rows that accident selected the uncensored
   *  profile. Read from the wire; never inferred. */
  behaviorProfileDefault?: boolean;
  /** The PHYSICAL model's name, identical across its aliases. */
  displayName?: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  /** The server's OTHER statement about thinking: the chat template opens
   *  `<think>` in the generation prompt, so the model reasons on every turn with
   *  no level to choose. `reasoning` answers a different question — whether the
   *  endpoint accepts a per-request effort — and a model is routinely false
   *  there and true here. */
  nativeReasoning?: boolean;
  thinkingLevels?: AgentThinkingLevel[];
  /** The server's statement that this row accepts tool calls. Wire-only:
   *  absent when the controller does not publish it, never guessed from a name. */
  tools?: boolean;
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
   *  plain OpenAI `reasoning_effort` default. Consumed by the agent runtime.
   *
   *  `chat-template-effort` — the template validates a reasoning_effort string,
   *  so the picker offers a real ladder.
   *  `native-always-on` — the template opens `<think>` in the generation prompt
   *  itself. The model reasons on every turn and there is no level to choose, so
   *  the picker shows one fixed state instead of a ladder it cannot honour. */
  thinkingContract?: "chat-template-effort" | "native-always-on";
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
  // Ornith-1.5-35B-A3B behind llama-swap. Its template carries no
  // reasoning_effort string at all, so the gateway advertises reasoning:false —
  // truthfully, about the request contract. It still thinks on every turn: the
  // template emits `<think>` as part of the generation prompt and the server
  // returns the trace as reasoning_content. Declaring it here is what stops the
  // picker showing "Off" for a model that cannot be turned off.
  "ornith-turbo": { reasoning: true, thinkingContract: "native-always-on" },
  // `qwen-uncensored` is NOT a fourth model. It is `qwen-daily` served with a
  // rank-1 refusal adapter at lambda 1 — the same GGUF in the same llama-server
  // process — so it speaks the identical chat template and therefore the
  // identical thinking contract. It is declared here rather than inferred for
  // the same reason `qwen-daily` is: the alias hides the checkpoint, and no
  // heuristic over the string "qwen-uncensored" can find the Qwen3 underneath.
  // See local-ai-3090-stack docs/adr/ADR-008.
  "qwen-uncensored": { reasoning: true, thinkingContract: "chat-template-effort" },
};

/** Declared capabilities for `modelId`, or undefined when nothing is declared. */
export function declaredModelReasoning(modelId: string): DeclaredModelReasoning | undefined {
  return DECLARED_MODEL_REASONING[modelId.trim().toLowerCase()];
}

export type ThinkingContract = NonNullable<DeclaredModelReasoning["thinkingContract"]>;

/** Everything a row has to say about which thinking contract it speaks. */
export type ThinkingContractInput = {
  /** The alias as its OWN controller names it — what the table is keyed by. */
  modelId?: string;
  /** The physical checkpoint the alias is served from, when the server says. */
  physicalModelId?: string;
  /** The server's own statement that the template thinks on every turn. */
  nativeReasoning?: boolean;
};

/**
 * The thinking contract a row speaks.
 *
 * THE SERVER FIRST. `nativeReasoning` is published per row, so it answers for an
 * alias no table has ever heard of; DECLARED_MODEL_REASONING is consulted only
 * where the row states nothing.
 *
 * THEN THE PHYSICAL MODEL, and only then the alias. Aliases of one checkpoint
 * are one llama-server speaking one chat template, so they MUST resolve to one
 * contract. Keying on the alias string alone is how a fourth alias of a known
 * model — "qwen-creative" — drew ["high","max"], a ladder its template rejects,
 * and how "ornith-uncensored" would have drawn ["off"] for a model that cannot
 * be turned off.
 */
export function resolveThinkingContract(
  input: ThinkingContractInput,
): ThinkingContract | undefined {
  if (input.nativeReasoning === true) return "native-always-on";
  return (
    declaredModelReasoning(input.physicalModelId ?? "")?.thinkingContract ??
    declaredModelReasoning(input.modelId ?? "")?.thinkingContract
  );
}

/** True when the row reasons on every turn with no selectable level. */
export function isNativeAlwaysOnThinkingModel(input: ThinkingContractInput): boolean {
  return resolveThinkingContract(input) === "native-always-on";
}

/** Name-only shorthand, for callers that hold an alias and nothing else. */
export function isNativeAlwaysOnThinkingModelId(modelId: string): boolean {
  return isNativeAlwaysOnThinkingModel({ modelId });
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

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
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

function snakeCaseKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function resolveExtraString(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const snake = snakeCaseKey(key);
  return firstString([metadata[key], metadata[snake], model[key], model[snake]]);
}

function resolveExtraBoolean(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const snake = snakeCaseKey(key);
  for (const value of [metadata[key], metadata[snake], model[key], model[snake]]) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
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
    physicalModelId: resolveExtraString(model, metadata, "physicalModelId") ?? id,
    behaviorProfile: resolveExtraString(model, metadata, "behaviorProfile"),
    behaviorProfileLabel: resolveExtraString(model, metadata, "behaviorProfileLabel"),
    behaviorProfileDefault: resolveExtraBoolean(model, metadata, "behaviorProfileDefault"),
    displayName: resolveExtraString(model, metadata, "displayName"),
    contextWindow,
    maxTokens,
    reasoning: resolveReasoning(model, metadata, id),
    nativeReasoning: resolveExtraBoolean(model, metadata, "nativeReasoning"),
    tools: resolveExtraBoolean(model, metadata, "tools"),
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

/** One physical checkpoint and every alias served from it. A group of one is
 *  still a group. */
export interface PhysicalModel {
  physicalModelId: string;
  /** The one label for this model. Callers render THIS; they do not rebuild it. */
  displayName: string;
  profiles: AgentModel[];
  /** The profile the server declares as this model's default — where a client
   *  lands when it picks the physical model without naming a behaviour. */
  primary: AgentModel;
}

/** True when one of this physical model's aliases is `modelId`. */
export function physicalModelOwnsProfile(
  physical: PhysicalModel,
  modelId: string | undefined,
): boolean {
  return Boolean(modelId) && physical.profiles.some((profile) => profile.id === modelId);
}

/**
 * Which alias a selection of the PHYSICAL model means.
 *
 * Falling straight through to the declared default made the OTHER profile
 * unreachable from a model list and rewrote a stored preference on the way: the
 * workspace writes its default model on every pick, so with the default on one
 * profile, a detour through another model and a click back on this one silently
 * moved the default onto the declared profile.
 *
 * Order is the whole rule. The alias already selected wins; then the alias
 * already stored as the default; and only when this model owns neither does the
 * server-declared default profile answer.
 */
export function resolveProfileId(
  physical: PhysicalModel,
  selectedModel: string,
  defaultModel?: string,
): string {
  if (physicalModelOwnsProfile(physical, selectedModel)) return selectedModel;
  if (defaultModel && physicalModelOwnsProfile(physical, defaultModel)) return defaultModel;
  return physical.primary.id;
}

/**
 * Collapse aliases onto the physical model they are served from, preserving the
 * order they arrived in — both between groups and within one group's profiles.
 *
 * Grouping is a view concern: this reads `physicalModelId` and nothing else, so
 * two rows that merely share a `displayName` stay apart, and a physical model
 * that grows a second profile tomorrow needs no change here.
 */
export function groupByPhysicalModel(models: AgentModel[]): PhysicalModel[] {
  const profilesByPhysicalId = new Map<string, AgentModel[]>();
  for (const model of models) {
    const key = model.physicalModelId?.trim() || model.id;
    const profiles = profilesByPhysicalId.get(key);
    if (profiles) profiles.push(model);
    else profilesByPhysicalId.set(key, [model]);
  }
  const groups: PhysicalModel[] = [];
  for (const [physicalModelId, profiles] of profilesByPhysicalId) {
    // THE SERVER NAMES THE DEFAULT. Exactly one alias per multi-profile model
    // carries `behaviorProfileDefault`, so selecting the physical model lands
    // where the product says it should rather than where a sort happened to put
    // it.
    //
    // `?? profiles[0]` is the answer for a group that declares NOTHING — a
    // single-profile model, or a gateway older than the field — and it is not
    // the mechanism. Index 0 is whatever the caller's sort produced, and both
    // feed paths sort by `name`: on the live rows llama-swap names the real
    // block "Qwen3.8-27B (daily)" while the cloned alias is "Qwen3.8-27B",
    // which sorts FIRST. Index 0 therefore selected the UNCENSORED profile, an
    // alias that is never a default anywhere.
    const primary = profiles.find((profile) => profile.behaviorProfileDefault) ?? profiles[0];
    groups.push({
      physicalModelId,
      // ONE LABEL, COMPUTED ONCE. Every surface that names this model — the
      // picker's list, the picker's trigger — reads it from here, so they
      // cannot disagree about what the user is talking to.
      displayName:
        firstString([
          ...profiles.map((profile) => profile.displayName),
          primary.rawId,
          primary.name,
        ]) ?? primary.name,
      profiles,
      primary,
    });
  }
  return groups;
}
