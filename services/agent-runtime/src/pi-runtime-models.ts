import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getApiSettings, type ApiSettings } from "./settings-service";
import { resolveDataDir } from "./data-dir";
import { listProviderAgentModels, refreshProviderHub } from "./provider-hub";
import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import {
  normalizeOpenAIModels,
  inferReasoningSupport,
  resolveThinkingContract,
  type AgentModel,
  type ThinkingContractInput,
} from "../../../shared/agent/models";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "../../../shared/agent/agent-turn";
import { CONTROL_PLANE_TIMEOUT_MS } from "../../../shared/agent/context-headroom";
import { resolveModelVision } from "../../../controller/contracts/model-capabilities";

const PROVIDER_ID = "local-studio";
const USER_PI_PREFIX = "user-pi-";

function userPiModelsPath(): string {
  const agentDir = process.env["PI_CODING_AGENT_DIR"]?.trim();
  return path.join(
    agentDir || path.join(process.env["HOME"] ?? homedir(), ".pi", "agent"),
    "models.json",
  );
}

type PiProviderModel = {
  id: string;
  name?: string;
  active?: boolean;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: Record<string, number>;
  compat?: Record<string, unknown>;
  thinkingLevelMap?: Partial<Record<AgentThinkingLevel, string | null>>;
};

type PiProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  api?: string;
  authHeader?: boolean;
  models?: PiProviderModel[];
  compat?: Record<string, unknown>;
};

type UserPiProviders = Record<string, PiProviderConfig>;

/** Strip any prefixes this writer has already applied.
 *
 *  When PI_CODING_AGENT_DIR points at Local Studio's own data dir — which it
 *  does for the desktop app — the file we read here is the file we write. Every
 *  pass therefore re-prefixed providers that were already prefixed, so
 *  "vibeproxy-claude" became "user-pi-vibeproxy-claude", then
 *  "user-pi-user-pi-vibeproxy-claude", growing by one hop per launch. Observed
 *  in the wild at 26 nested hops and a 466 KB models.json.
 *
 *  Collapsing on read makes the merge idempotent and self-heals files that have
 *  already grown. */
function baseProviderName(name: string): string {
  let base = name;
  while (base.startsWith(USER_PI_PREFIX)) base = base.slice(USER_PI_PREFIX.length);
  return base;
}

async function loadUserPiProviders(): Promise<UserPiProviders> {
  const modelsPath = userPiModelsPath();
  if (!existsSync(modelsPath)) return {};
  try {
    const parsed = JSON.parse(await readFile(modelsPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const providers = (parsed as { providers?: unknown }).providers;
    if (!providers || typeof providers !== "object" || Array.isArray(providers)) return {};
    const collapsed: UserPiProviders = {};
    for (const [name, config] of Object.entries(providers as UserPiProviders)) {
      const base = baseProviderName(name);
      // Our own controller providers are regenerated from the live controller
      // every pass; reading them back would duplicate them under a user-pi name
      // the moment the controller went away. Test the COLLAPSED name — a prior
      // pass has already produced "user-pi-local-studio" in the wild, which is
      // our own provider wearing a user-pi hat.
      if (!base || base === PROVIDER_ID || base.startsWith(`${PROVIDER_ID}-`)) continue;
      collapsed[base] = config;
    }
    return collapsed;
  } catch {
    return {};
  }
}

function userPiModelToAgentModel(
  providerName: string,
  qualifiedProviderId: string,
  model: PiProviderModel,
  providerCompat?: Record<string, unknown>,
): AgentModel {
  const rawId = model.id;
  const name = model.name ?? rawId;
  const inputs = model.input ?? ["text"];
  const reasoning = model.reasoning ?? inferReasoningSupport(rawId);
  const id = `${qualifiedProviderId}/${rawId}`;
  return {
    id,
    physicalModelId: id,
    rawId,
    name: `${name} · ${providerName}`,
    provider: "local-studio",
    providerId: qualifiedProviderId,
    controllerName: providerName,
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxTokens ?? 65_536,
    reasoning,
    thinkingLevels: supportedPiThinkingLevels(model, reasoning, providerCompat),
    vision: resolveModelVision({ identifiers: [rawId], modalities: [inputs] }),
    active: false,
  };
}

function supportedPiThinkingLevels(
  model: PiProviderModel,
  reasoning: boolean,
  providerCompat?: Record<string, unknown>,
): AgentThinkingLevel[] {
  if (!reasoning) return ["off"];
  const supportsReasoningEffort =
    model.compat?.supportsReasoningEffort ?? providerCompat?.supportsReasoningEffort;
  if (supportsReasoningEffort !== true) return ["high"];
  return AGENT_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

function isInklingModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("inkling");
}

/** The physical checkpoint as its OWN controller names it.
 *
 *  `physicalModelId` is qualified with the provider for every controller after
 *  the first, exactly as `id` is, while the declaration table is keyed by the
 *  bare alias. This is the same unqualification `resolvePiModelSelection` does
 *  for a model id, applied to the grouping key. */
function barePhysicalModelId(model: AgentModel): string {
  return resolvePiModelSelection(model.physicalModelId ?? "").modelId;
}

/** What a model row states about its thinking contract, server first. */
function modelThinkingContract(model: AgentModel) {
  return resolveThinkingContract({
    modelId: model.rawId ?? model.id,
    physicalModelId: barePhysicalModelId(model),
    nativeReasoning: model.nativeReasoning,
  });
}

/** One entry, so the picker renders a FIXED state instead of a ladder. */
const NATIVE_ALWAYS_ON_THINKING_LEVELS: readonly AgentThinkingLevel[] = ["high"];

/** Off / Low / Medium / XHigh — the only efforts the chat template accepts.
 *  Minimal, High and Max are deliberately absent, and XHigh is never Max. */
const CHAT_TEMPLATE_THINKING_LEVELS: readonly AgentThinkingLevel[] = [
  "off",
  "low",
  "medium",
  "xhigh",
];

/**
 * The ladder an alias may offer.
 *
 * `source` is what the SERVER said about this row — its physical model and its
 * `nativeReasoning` flag. Passing it is what makes two aliases of one checkpoint
 * resolve to one ladder; omitting it falls back to the name table alone, which
 * is all a caller holding a bare id can do.
 */
export function controllerModelThinkingLevels(
  reasoning: boolean,
  modelId = "",
  source: Omit<ThinkingContractInput, "modelId"> = {},
): AgentThinkingLevel[] {
  const contract = resolveThinkingContract({ ...source, modelId });
  // Gated on `reasoning` because that IS the server's statement about the
  // request contract: a checkpoint served with thinking off takes no effort.
  if (reasoning && contract === "chat-template-effort") {
    return [...CHAT_TEMPLATE_THINKING_LEVELS];
  }
  // Deliberately NOT gated on `reasoning`: the gateway reports reasoning:false
  // for this contract because it accepts no effort contract, which is a
  // different statement from "does not think".
  if (contract === "native-always-on") {
    return [...NATIVE_ALWAYS_ON_THINKING_LEVELS];
  }
  if (reasoning && isInklingModelId(modelId)) {
    return ["off", "minimal", "low", "medium", "high", "max"];
  }
  return AGENT_THINKING_LEVELS.filter((level) =>
    reasoning ? level === "high" || level === "max" : level === "off",
  );
}

export type PiControllerModelsRequest = {
  url: string;
  apiKey?: string;
  name?: string;
};

type PiControllerConfig = {
  url: string;
  apiKey: string;
  name?: string;
};

type ControllerModels = {
  controller: PiControllerConfig;
  models: AgentModel[];
  providerId: string;
};

function controllersPath(agentDir: string): string {
  return path.join(agentDir, "controllers.json");
}

function modelCachePath(agentDir: string): string {
  return path.join(agentDir, "controller-models.cache.json");
}

//
// A controller that is asleep does not refuse a connection — on a tailnet
// nothing sends an RST, so every probe costs the full timeout. Paying eight
// seconds is worth it once, to tell "asleep" from "slow"; paying it on every
// retry is what made the model picker sit in a spinner forever with the RTX
// off. So a controller that has just failed is re-probed briefly, and one
// success restores the patient timeout.
//
//
// A controller that is up answers /v1/models in tens of milliseconds — it is a
// static list — so the impatient probe costs a live host nothing, and one
// success clears the mark immediately. The expiry therefore only exists for a
// host that is alive but slower than the impatient budget, which is rare and
// self-correcting; keeping it at a minute meant every cold start more than a
// minute after the last one paid the full eight seconds again, which is the
// case the owner actually feels.
//
const OFFLINE_CONTROLLER_TIMEOUT_MS = 2_500;
const OFFLINE_MEMORY_MS = 15 * 60_000;
const offlineControllers = new Map<string, number>();
let offlineControllersDir: string | null = null;

function offlinePath(agentDir: string): string {
  return path.join(agentDir, "controller-offline.json");
}

//
// Persisted, because the expensive case is precisely a cold start: a fresh
// process with an empty map spends the full timeout on a host it already knew
// was asleep, and that eight seconds is the whole of "the app takes forever to
// open". Surviving the restart is what makes the first launch fast too.
//
async function loadOfflineControllers(agentDir: string): Promise<void> {
  offlineControllersDir = agentDir;
  if (offlineControllers.size > 0) return;
  try {
    const parsed = JSON.parse(await readFile(offlinePath(agentDir), "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    for (const [url, since] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof since === "number") offlineControllers.set(url, since);
    }
  } catch {
    // No memory of a previous run is simply the patient path.
  }
}

function persistOfflineControllers(): void {
  const agentDir = offlineControllersDir;
  if (!agentDir) return;
  void writeFile(
    offlinePath(agentDir),
    JSON.stringify(Object.fromEntries(offlineControllers)),
    "utf-8",
  ).catch(() => undefined);
}

function controllerTimeoutMs(url: string): number {
  const since = offlineControllers.get(url);
  if (since === undefined) return CONTROL_PLANE_TIMEOUT_MS;
  if (Date.now() - since > OFFLINE_MEMORY_MS) {
    // Long enough since the last failure that the host may well be back; spend
    // the full timeout again rather than writing it off on a 1.5s probe.
    offlineControllers.delete(url);
    persistOfflineControllers();
    return CONTROL_PLANE_TIMEOUT_MS;
  }
  return OFFLINE_CONTROLLER_TIMEOUT_MS;
}

function markControllerReachable(url: string): void {
  if (offlineControllers.delete(url)) persistOfflineControllers();
}

function markControllerUnreachable(url: string): void {
  if (offlineControllers.has(url)) return;
  offlineControllers.set(url, Date.now());
  persistOfflineControllers();
}

//
// Keyed by controller URL, not one flat list, so a host that is asleep keeps
// contributing its own models while the hosts that are up contribute theirs
// live. Dropping an offline host's models entirely was the second half of
// "I cannot see models with the 3090 off": the Mac answering did not bring the
// RTX aliases back, it just stopped the list being empty.
//
type ModelCache = Record<string, AgentModel[]>;

async function readModelCache(agentDir: string): Promise<ModelCache> {
  try {
    const parsed = JSON.parse(await readFile(modelCachePath(agentDir), "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const cache: ModelCache = {};
    for (const [url, models] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(models)) continue;
      cache[url] = models.filter(
        (entry): entry is AgentModel =>
          Boolean(
            entry && typeof entry === "object" && typeof (entry as AgentModel).id === "string",
          ),
      );
    }
    return cache;
  } catch {
    return {};
  }
}

async function writeModelCache(agentDir: string, cache: ModelCache): Promise<void> {
  try {
    await writeFile(modelCachePath(agentDir), JSON.stringify(cache), "utf-8");
    await chmod(modelCachePath(agentDir), 0o600).catch(() => undefined);
  } catch {
    // A cache that cannot be written is a missed optimisation, never an error
    // the caller should see: the live list it was about to return is fine.
  }
}

function controllerLabel(controller: PiControllerConfig, index: number): string {
  if (controller.name?.trim()) return controller.name.trim();
  try {
    return new URL(controller.url).host;
  } catch {
    return index === 0 ? "primary" : `controller ${index + 1}`;
  }
}

function providerIdForController(controller: PiControllerConfig, index: number): string {
  if (index === 0) return PROVIDER_ID;
  const normalized = controller.url
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${PROVIDER_ID}-${normalized || index + 1}`;
}

function qualifyModelId(providerId: string, rawId: string): string {
  return providerId === PROVIDER_ID ? rawId : `${providerId}/${rawId}`;
}

function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeControllerInput(input: PiControllerModelsRequest): PiControllerConfig | null {
  const url = normalizeBackendUrl(input.url || "");
  if (!url) return null;
  const apiKey = input.apiKey?.trim() ?? "";
  const name = input.name?.trim();
  return {
    url,
    apiKey,
    ...(name ? { name } : {}),
  };
}

function mergeControllers(
  settings: ApiSettings,
  requested: PiControllerModelsRequest[] = [],
): PiControllerConfig[] {
  const requestedControllers = requested
    .map(normalizeControllerInput)
    .filter((controller): controller is PiControllerConfig => controller !== null);
  if (requestedControllers.length > 0) {
    return [
      ...new Map(requestedControllers.map((controller) => [controller.url, controller])).values(),
    ];
  }
  const primary = normalizeControllerInput({
    url: settings.backendUrl,
    apiKey: settings.apiKey,
    name: "primary",
  });
  return primary ? [primary] : [];
}

async function loadPersistedControllers(agentDir: string): Promise<PiControllerModelsRequest[]> {
  const file = controllersPath(agentDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is PiControllerModelsRequest =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
      .flatMap((entry) => {
        const record = entry as Record<string, unknown>;
        return typeof record.url === "string"
          ? [
              {
                url: record.url,
                ...(typeof record.apiKey === "string" ? { apiKey: record.apiKey } : {}),
                ...(typeof record.name === "string" ? { name: record.name } : {}),
              },
            ]
          : [];
      });
  } catch {
    return [];
  }
}

async function savePersistedControllers(
  agentDir: string,
  controllers: PiControllerConfig[],
): Promise<void> {
  await writeFile(controllersPath(agentDir), JSON.stringify(controllers, null, 2), "utf-8");
  await chmod(controllersPath(agentDir), 0o600).catch(() => undefined);
}

async function fetchModelsFromController(
  controller: PiControllerConfig,
  index: number,
  multipleControllers: boolean,
): Promise<ControllerModels> {
  const backendUrl = normalizeBackendUrl(controller.url);
  const headers: HeadersInit = { Accept: "application/json" };
  if (controller.apiKey) headers.Authorization = `Bearer ${controller.apiKey}`;
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/v1/models`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(controllerTimeoutMs(backendUrl)),
    });
  } catch (error) {
    markControllerUnreachable(backendUrl);
    throw error;
  }
  if (!response.ok) {
    // It answered, so it is awake — a 500 from a live controller must not make
    // the next probe impatient.
    markControllerReachable(backendUrl);
    throw new Error(`${backendUrl}/v1/models failed with HTTP ${response.status}`);
  }
  markControllerReachable(backendUrl);
  const payload = (await response.json()) as unknown;
  const providerId = providerIdForController(controller, index);
  const label = controllerLabel(controller, index);
  const models = normalizeOpenAIModels(payload && typeof payload === "object" ? payload : {}).map(
    (model) => ({
      ...model,
      reasoning: model.reasoning,
      id: qualifyModelId(providerId, model.id),
      physicalModelId: qualifyModelId(providerId, model.physicalModelId),
      rawId: model.id,
      providerId,
      controllerUrl: backendUrl,
      controllerName: label,
      // The row is still unqualified here, so its `physicalModelId` is the bare
      // alias the declaration table is keyed by.
      thinkingLevels: controllerModelThinkingLevels(model.reasoning, model.rawId ?? model.id, {
        physicalModelId: model.physicalModelId,
        nativeReasoning: model.nativeReasoning,
      }),
      name: multipleControllers ? `${model.name} · ${label}` : model.name,
    }),
  );
  return { controller: { ...controller, url: backendUrl }, models, providerId };
}

async function fetchModelsFromControllers(
  controllers: PiControllerConfig[],
  cache: ModelCache,
): Promise<{
  models: AgentModel[];
  controllerModels: ControllerModels[];
  offlineControllerUrls: string[];
}> {
  const settled = await Promise.allSettled(
    controllers.map((controller, index) =>
      fetchModelsFromController(controller, index, controllers.length > 1),
    ),
  );
  const controllerModels: ControllerModels[] = [];
  const offlineControllerUrls: string[] = [];
  settled.forEach((result, index) => {
    const controller = controllers[index];
    if (result.status === "fulfilled") {
      controllerModels.push(result.value);
      return;
    }
    if (!controller) return;
    //
    // The host did not answer, but we have seen it before. Keep its models in
    // the list so the picker still shows them: choosing one is a reasonable
    // thing to do — it is how the owner asks for that host to be woken — and a
    // send that cannot reach it fails with a clear message. An empty picker
    // offers no such move.
    //
    const url = normalizeBackendUrl(controller.url);
    const cached = cache[url];
    if (cached && cached.length > 0) {
      offlineControllerUrls.push(url);
      controllerModels.push({
        controller: { ...controller, url },
        models: cached,
        providerId: providerIdForController(controller, index),
      });
    }
  });
  if (controllerModels.length === 0) {
    const firstError = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error("No controllers returned models.");
  }
  const seen = new Set<string>();
  const models: AgentModel[] = [];
  for (const result of controllerModels) {
    for (const model of result.models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  return {
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
    controllerModels,
    offlineControllerUrls,
  };
}

async function writePiModelsConfig(
  controllerModels: ControllerModels[],
  userPiProviders: UserPiProviders,
): Promise<string> {
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);

  const vllmProviders = Object.fromEntries(
    controllerModels.map(({ controller, models, providerId }) => [
      providerId,
      {
        baseUrl: `${controller.url}/v1`,
        api: "openai-completions",
        apiKey: controller.apiKey || "local-studio",
        authHeader: Boolean(controller.apiKey),
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
        models: modelsToPiModels(models),
      },
    ]),
  );

  const providers: Record<string, unknown> = { ...vllmProviders };
  for (const [name, config] of Object.entries(userPiProviders)) {
    providers[`${USER_PI_PREFIX}${name}`] = {
      baseUrl: config.baseUrl,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.api ? { api: config.api } : {}),
      ...(config.authHeader !== undefined ? { authHeader: config.authHeader } : {}),
      ...(config.compat ? { compat: config.compat } : {}),
      models: config.models ?? [],
    };
  }

  const modelsPath = path.join(agentDir, "models.json");
  await writeFile(modelsPath, JSON.stringify({ providers }, null, 2), "utf-8");
  await chmod(modelsPath, 0o600).catch(() => undefined);
  return agentDir;
}

export function resolvePiModelSelection(modelId: string): { providerId: string; modelId: string } {
  const separator = modelId.indexOf("/");
  if (separator > 0) {
    const maybeProvider = modelId.slice(0, separator);
    if (maybeProvider.startsWith(USER_PI_PREFIX) || maybeProvider.startsWith(`${PROVIDER_ID}-`)) {
      return { providerId: maybeProvider, modelId: modelId.slice(separator + 1) };
    }
  }
  return { providerId: PROVIDER_ID, modelId };
}

export async function refreshPiModels(
  requestedControllers?: PiControllerModelsRequest[],
): Promise<{ models: AgentModel[]; agentDir: string; stale: boolean }> {
  const settings = await getApiSettings();
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);
  await loadOfflineControllers(agentDir);
  const persisted =
    requestedControllers && requestedControllers.length > 0
      ? requestedControllers
      : await loadPersistedControllers(agentDir);
  const ownerControllers = settings.controllers.length > 0 ? settings.controllers : persisted;
  const controllers = mergeControllers(settings, ownerControllers);
  await savePersistedControllers(agentDir, controllers);
  // A dead controller must not hide signed-in cloud providers: collect the
  // failure and only surface it when nothing else can serve models.
  let models: AgentModel[] = [];
  let controllerModels: ControllerModels[] = [];
  let controllerError: unknown = null;
  let offlineControllerUrls: string[] = [];
  const cache = await readModelCache(agentDir);
  try {
    ({ models, controllerModels, offlineControllerUrls } = await fetchModelsFromControllers(
      controllers,
      cache,
    ));
  } catch (error) {
    controllerError = error;
  }

  const userPiProviders = await loadUserPiProviders();
  const userPiModels = Object.entries(userPiProviders).flatMap(([providerName, config]) => {
    const qualifiedProviderId = `${USER_PI_PREFIX}${providerName}`;
    return (config.models ?? []).map((model) =>
      userPiModelToAgentModel(providerName, qualifiedProviderId, model, config.compat),
    );
  });
  const writtenAgentDir = await writePiModelsConfig(controllerModels, userPiProviders);
  const providerModels = await collectProviderAgentModels();

  //
  // Only what a host actually answered updates its own cache entry: models
  // replayed from the cache for an offline host must not be written back as if
  // they had just been observed, or the entry would never age out.
  //
  const offline = new Set(offlineControllerUrls);
  let cacheChanged = false;
  for (const entry of controllerModels) {
    if (offline.has(entry.controller.url) || entry.models.length === 0) continue;
    cache[entry.controller.url] = entry.models;
    cacheChanged = true;
  }
  if (cacheChanged) await writeModelCache(agentDir, cache);

  const allModels = [...models, ...userPiModels, ...providerModels];
  if (allModels.length === 0 && controllerError) {
    throw controllerError instanceof Error
      ? controllerError
      : new Error("No controllers returned models.");
  }
  return { models: allModels, agentDir: writtenAgentDir, stale: offline.size > 0 };
}
async function collectProviderAgentModels(): Promise<AgentModel[]> {
  await refreshProviderHub().catch(() => undefined);
  return listProviderAgentModels();
}

// Moved here from the shared models module: only the runtime needs the
// pi-model mapping, and the OpenAICompletionsCompat type must resolve against
// the SDK install.
function isDeepSeekReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("deepseek");
}

function isControllerBackedModel(model: AgentModel): boolean {
  return typeof model.controllerUrl === "string" && model.controllerUrl.length > 0;
}

function isInklingReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("inkling");
}

function isChatTemplateReasoningModel(model: AgentModel): boolean {
  // Same resolution as the ladder, so the levels the picker offers and the wire
  // shape those levels travel in cannot come apart for a new alias.
  return model.reasoning && modelThinkingContract(model) === "chat-template-effort";
}

type PiThinkingContract = {
  thinkingLevelMap?: Partial<Record<AgentThinkingLevel, string | null>>;
  compat?: Partial<OpenAICompletionsCompat>;
};

/** The reasoning half of a model's pi contract. pi-ai consumes this as DATA —
 *  it builds the request body itself — so this is the only place the wire shape
 *  is decided, and it reaches main chat, the Computer side-chat, compaction,
 *  automations and subagents through pi-agent/models.json. */
function piThinkingContract(model: AgentModel): PiThinkingContract {
  if (isChatTemplateReasoningModel(model)) {
    return {
      // `null` marks a level UNSUPPORTED — that is what keeps Minimal, High and
      // Max out of the picker. `off` stays unmapped on purpose: this template
      // turns thinking off through enable_thinking, not through an effort value.
      thinkingLevelMap: {
        minimal: null,
        low: "low",
        medium: "medium",
        high: null,
        xhigh: "xhigh",
        max: null,
      },
      compat: {
        thinkingFormat: "chat-template",
        chatTemplateKwargs: {
          enable_thinking: { $var: "thinking.enabled" },
          reasoning_effort: { $var: "thinking.effort", omitWhenOff: true },
        },
      },
    };
  }
  // The hosted DeepSeek API uses a `thinking` object and requires an empty
  // `reasoning_content` field on replayed assistant messages. Our vLLM
  // controller exposes DeepSeek V4 through the standard OpenAI-compatible
  // surface instead, where that hosted-only dialect corrupts tool-history
  // turns. Keep the ordinary `reasoning_effort` mapping for controller models.
  if (isDeepSeekReasoningModel(model) && !isControllerBackedModel(model)) {
    return {
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "max",
        max: "max",
      },
      compat: {
        thinkingFormat: "deepseek",
        requiresReasoningContentOnAssistantMessages: true,
      },
    };
  }
  if (isInklingReasoningModel(model)) {
    return {
      thinkingLevelMap: {
        off: "none",
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: "max",
      },
    };
  }
  return {};
}

const VLLM_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsStrictMode: false,
  supportsUsageInStreaming: true,
  maxTokensField: "max_completion_tokens",
};

export function modelsToPiModels(models: AgentModel[]) {
  return models.map((model) => {
    const thinking = piThinkingContract(model);
    return {
      id: model.rawId ?? model.id,
      name: model.name,
      active: model.active,
      reasoning: model.reasoning,
      input: model.vision ? ["text", "image"] : ["text"],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(thinking.thinkingLevelMap ? { thinkingLevelMap: thinking.thinkingLevelMap } : {}),
      compat: { ...VLLM_OPENAI_COMPAT, ...thinking.compat },
    };
  });
}
