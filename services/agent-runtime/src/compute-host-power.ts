import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WAKE_READY_TIMEOUT_MS,
  WAKE_COOLDOWN_MS,
  isComputeHostOnline,
  redactWakeUrl,
  type ComputeHostConfig,
  type ComputeHostPowerState,
  type ComputeHostStatus,
  type ComputeHostWakeResult,
} from "../../../shared/agent/compute-host";
import { resolveDataDir } from "./data-dir";
import { getGlobalSingleton } from "./instances";

const PROBE_TIMEOUT_MS = 4_000;
const WAKE_REQUEST_TIMEOUT_MS = 12_000;
const READY_POLL_INTERVAL_MS = 5_000;
const STATUS_CACHE_MS = 8_000;

type HostRuntimeState = {
  lastSeenAt: string | null;
  lastWakeAt: string | null;
  lastWakeOutcome: "ready" | "timeout" | "failed" | null;
};

type HostRuntime = {
  cache: Map<string, { status: ComputeHostStatus; expiresAt: number }>;
  inFlight: Map<string, Promise<ComputeHostWakeResult>>;
  persisted: Map<string, HostRuntimeState>;
  loaded: boolean;
};

function runtime(): HostRuntime {
  return getGlobalSingleton<HostRuntime>("computeHostPower", () => ({
    cache: new Map(),
    inFlight: new Map(),
    persisted: new Map(),
    loaded: false,
  }));
}

function statePath(): string {
  return path.join(resolveDataDir(), "compute-host-state.json");
}

async function loadPersisted(): Promise<void> {
  const state = runtime();
  if (state.loaded) return;
  state.loaded = true;
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(), "utf-8"));
    if (parsed !== null && typeof parsed === "object") {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value !== null && typeof value === "object") {
          const row = value as Partial<HostRuntimeState>;
          state.persisted.set(id, {
            lastSeenAt: typeof row.lastSeenAt === "string" ? row.lastSeenAt : null,
            lastWakeAt: typeof row.lastWakeAt === "string" ? row.lastWakeAt : null,
            lastWakeOutcome:
              row.lastWakeOutcome === "ready" ||
              row.lastWakeOutcome === "timeout" ||
              row.lastWakeOutcome === "failed"
                ? row.lastWakeOutcome
                : null,
          });
        }
      }
    }
  } catch {
    return;
  }
}

async function savePersisted(): Promise<void> {
  const state = runtime();
  const payload = Object.fromEntries(state.persisted.entries());
  const target = statePath();
  const staging = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(staging, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    await chmod(staging, 0o600).catch(() => undefined);
    await rename(staging, target);
  } catch {
    return;
  }
}

function persistedFor(id: string): HostRuntimeState {
  const state = runtime();
  const existing = state.persisted.get(id);
  if (existing) return existing;
  const created: HostRuntimeState = { lastSeenAt: null, lastWakeAt: null, lastWakeOutcome: null };
  state.persisted.set(id, created);
  return created;
}

type ControlStatusPayload = {
  ok?: boolean;
  titulo?: string;
  mensagem?: string;
  detalhes?: {
    gateway?: boolean | null;
    modelo?: string | null;
    carregando?: string | null;
    vram_usada_mb?: number | null;
    vram_livre_mb?: number | null;
    ultimo_erro?: string | null;
  };
};

function stateFromPayload(payload: ControlStatusPayload): ComputeHostPowerState {
  const details = payload.detalhes ?? {};
  if (details.gateway === false) return "gaming";
  if (typeof details.carregando === "string" && details.carregando.length > 0) return "gateway-idle";
  if (typeof details.modelo === "string" && details.modelo.length > 0) return "model-resident";
  if (details.gateway === true) return "gateway-idle";
  return "unknown";
}

async function probeControl(config: ComputeHostConfig): Promise<ControlStatusPayload | null> {
  const base = config.controlUrl.trim().replace(/\/+$/, "");
  if (!base || !config.controlToken.trim()) return null;
  try {
    const response = await fetch(`${base}/gpu/status`, {
      headers: { "X-Auth-Token": config.controlToken },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as ControlStatusPayload;
  } catch {
    return null;
  }
}

function buildStatus(
  config: ComputeHostConfig,
  payload: ControlStatusPayload | null,
  overrideState?: ComputeHostPowerState,
): ComputeHostStatus {
  const state = runtime();
  const stored = persistedFor(config.id);
  const now = new Date();
  const details = payload?.detalhes ?? {};
  const resolved = overrideState ?? (payload ? stateFromPayload(payload) : "unreachable");
  if (payload) stored.lastSeenAt = now.toISOString();

  const usedMb = typeof details.vram_usada_mb === "number" ? details.vram_usada_mb : null;
  const freeMb = typeof details.vram_livre_mb === "number" ? details.vram_livre_mb : null;
  const cooldownEnds = stored.lastWakeAt
    ? new Date(new Date(stored.lastWakeAt).getTime() + WAKE_COOLDOWN_MS)
    : null;

  return {
    id: config.id,
    name: config.name,
    state: resolved,
    detail: typeof payload?.titulo === "string" ? payload.titulo : null,
    gpuUsedMb: usedMb,
    gpuTotalMb: usedMb !== null && freeMb !== null ? usedMb + freeMb : null,
    residentModel: typeof details.modelo === "string" ? details.modelo : null,
    gatewayUp: typeof details.gateway === "boolean" ? details.gateway : null,
    lastSeenAt: stored.lastSeenAt,
    checkedAt: now.toISOString(),
    wakeConfigured: config.wakeUrl.trim().length > 0,
    wakeEnabled: config.wakeEnabled,
    autoWake: config.autoWake,
    wakeInFlight: state.inFlight.has(config.id),
    wakeCooldownUntil:
      cooldownEnds && cooldownEnds.getTime() > now.getTime() ? cooldownEnds.toISOString() : null,
    lastWakeAt: stored.lastWakeAt,
    lastWakeOutcome: stored.lastWakeOutcome,
  };
}

export async function computeHostStatus(
  config: ComputeHostConfig,
  options: { force?: boolean } = {},
): Promise<ComputeHostStatus> {
  await loadPersisted();
  const state = runtime();
  const cached = state.cache.get(config.id);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.status;

  const override = state.inFlight.has(config.id) ? "waking" : undefined;
  const payload = await probeControl(config);
  const status = buildStatus(config, payload, payload ? undefined : override);
  state.cache.set(config.id, { status, expiresAt: Date.now() + STATUS_CACHE_MS });
  if (payload) void savePersisted();
  return status;
}

function invalidate(id: string): void {
  runtime().cache.delete(id);
}

async function sendWakeRequest(config: ComputeHostConfig): Promise<boolean> {
  try {
    const response = await fetch(config.wakeUrl, {
      signal: AbortSignal.timeout(WAKE_REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReady(config: ComputeHostConfig): Promise<"ready" | "timeout"> {
  const deadline =
    Date.now() + (config.readyTimeoutMs > 0 ? config.readyTimeoutMs : DEFAULT_WAKE_READY_TIMEOUT_MS);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    const payload = await probeControl(config);
    if (payload && isComputeHostOnline(stateFromPayload(payload))) return "ready";
  }
  return "timeout";
}

export async function wakeComputeHost(
  config: ComputeHostConfig,
): Promise<ComputeHostWakeResult> {
  await loadPersisted();
  const state = runtime();

  if (!config.wakeUrl.trim()) {
    const status = await computeHostStatus(config);
    return {
      id: config.id,
      accepted: false,
      reason: "not-configured",
      state: status.state,
      message: "No wake URL is configured for this host.",
    };
  }
  if (!config.wakeEnabled) {
    const status = await computeHostStatus(config);
    return {
      id: config.id,
      accepted: false,
      reason: "disabled",
      state: status.state,
      message: "Wake on demand is turned off for this host.",
    };
  }

  const running = state.inFlight.get(config.id);
  if (running) {
    const status = await computeHostStatus(config);
    return {
      id: config.id,
      accepted: false,
      reason: "in-flight",
      state: status.state,
      message: "A wake attempt for this host is already running.",
    };
  }

  const current = await computeHostStatus(config, { force: true });
  if (isComputeHostOnline(current.state)) {
    return {
      id: config.id,
      accepted: false,
      reason: "already-online",
      state: current.state,
      message: "The host is already reachable.",
    };
  }

  const stored = persistedFor(config.id);
  const since = stored.lastWakeAt ? Date.now() - new Date(stored.lastWakeAt).getTime() : Infinity;
  if (since < WAKE_COOLDOWN_MS) {
    return {
      id: config.id,
      accepted: false,
      reason: "cooling-down",
      state: current.state,
      message: `A wake was sent ${Math.round(since / 1000)}s ago; waiting for the host to come up.`,
    };
  }

  const attempt = (async (): Promise<ComputeHostWakeResult> => {
    stored.lastWakeAt = new Date().toISOString();
    stored.lastWakeOutcome = null;
    await savePersisted();
    invalidate(config.id);

    const sent = await sendWakeRequest(config);
    if (!sent) {
      stored.lastWakeOutcome = "failed";
      await savePersisted();
      console.warn(
        `[compute-host] wake request failed for ${config.id} via ${redactWakeUrl(config.wakeUrl)}`,
      );
      return {
        id: config.id,
        accepted: false,
        reason: "failed",
        state: "unreachable",
        message: "The wake provider did not accept the request.",
      };
    }

    console.log(
      `[compute-host] wake sent for ${config.id} via ${redactWakeUrl(config.wakeUrl)}, waiting for readiness`,
    );
    const outcome = await waitForReady(config);
    stored.lastWakeOutcome = outcome;
    await savePersisted();
    invalidate(config.id);
    const status = await computeHostStatus(config, { force: true });
    return {
      id: config.id,
      accepted: true,
      reason: "sent",
      state: status.state,
      message:
        outcome === "ready"
          ? "The host came up and the AI stack is reachable."
          : "The wake packet was sent, but the host did not become reachable before the timeout.",
    };
  })();

  state.inFlight.set(config.id, attempt);
  try {
    return await attempt;
  } finally {
    state.inFlight.delete(config.id);
    invalidate(config.id);
  }
}

export async function ensureComputeHostAwake(
  config: ComputeHostConfig,
): Promise<ComputeHostWakeResult | null> {
  if (!config.autoWake || !config.wakeEnabled || !config.wakeUrl.trim()) return null;
  const status = await computeHostStatus(config);
  if (isComputeHostOnline(status.state)) return null;
  return wakeComputeHost(config);
}
