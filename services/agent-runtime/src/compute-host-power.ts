import { createSocket } from "node:dgram";
import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WAKE_READY_TIMEOUT_MS,
  WAKE_COOLDOWN_MS,
  DEFAULT_WAKE_BROADCAST,
  isComputeHostOnline,
  magicPacket,
  redactWakeUrl,
  type ComputeHostConfig,
  type ComputeHostPowerState,
  type ComputeHostStatus,
  type ComputeHostWakeMethod,
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

async function probeOne(
  base: string,
  token: string,
): Promise<ControlStatusPayload | null> {
  try {
    const response = await fetch(`${base}/gpu/status`, {
      headers: { "X-Auth-Token": token },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as ControlStatusPayload;
  } catch {
    return null;
  }
}

//
// The tailnet address is the one that works from anywhere, so it is always
// tried first. The LAN address exists for the evening the internet is down and
// the power is not: this Mac is still home, the host is still on, and there is
// no reason for the panel to go dark. It is tried exactly once after the
// tailnet address fails, never in a loop — a host that is genuinely asleep
// should be reported as unreachable quickly rather than retried into a stall.
//
async function probeControl(config: ComputeHostConfig): Promise<ControlStatusPayload | null> {
  const token = config.controlToken.trim();
  if (!token) return null;
  const primary = config.controlUrl.trim().replace(/\/+$/, "");
  const fallback = config.controlUrlFallback.trim().replace(/\/+$/, "");
  if (primary) {
    const payload = await probeOne(primary, token);
    if (payload) return payload;
  }
  if (fallback && fallback !== primary) return probeOne(fallback, token);
  return null;
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
    wakeConfigured: wakeMethodsFor(config).length > 0,
    wakeMethods: wakeMethodsFor(config),
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

function wakeMethodsFor(config: ComputeHostConfig): ComputeHostWakeMethod[] {
  const methods: ComputeHostWakeMethod[] = [];
  if (config.wakeUrl.trim().length > 0) methods.push("http-bridge");
  if (magicPacket(config.wakeMac) !== null) methods.push("lan-magic-packet");
  return methods;
}

function sendMagicPacket(config: ComputeHostConfig): Promise<boolean> {
  const packet = magicPacket(config.wakeMac);
  if (packet === null) return Promise.resolve(false);
  const target = config.wakeBroadcast.trim() || DEFAULT_WAKE_BROADCAST;
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // The socket is already closing; the result is what matters.
      }
      resolve(ok);
    };
    socket.once("error", () => finish(false));
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch {
        finish(false);
        return;
      }
      // Port 9 is the conventional discard port for Wake-on-LAN. 7 is also
      // used; a NIC listening for the pattern does not care which it arrives
      // on, so sending to both costs nothing and covers more firmware.
      let pending = 2;
      const done = (error: Error | null) => {
        if (error) finish(false);
        pending -= 1;
        if (pending === 0) finish(true);
      };
      socket.send(packet, 9, target, done);
      socket.send(packet, 7, target, done);
    });
    setTimeout(() => finish(false), 5_000);
  });
}

async function sendWakeRequest(
  config: ComputeHostConfig,
): Promise<{ ok: boolean; method: ComputeHostWakeMethod | null }> {
  // The bridge goes first because it answers from anywhere. Each method is
  // tried once: neither returns an acknowledgement from the host, so a success
  // here means "the request left", not "the host woke", and repeating it would
  // only hammer a public endpoint. Readiness is decided by polling.
  if (config.wakeUrl.trim()) {
    try {
      const response = await fetch(config.wakeUrl, {
        signal: AbortSignal.timeout(WAKE_REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return { ok: true, method: "http-bridge" };
    } catch {
      // Falls through to the LAN packet, which is what being home is for.
    }
  }
  if (magicPacket(config.wakeMac) !== null) {
    const sent = await sendMagicPacket(config);
    if (sent) return { ok: true, method: "lan-magic-packet" };
  }
  return { ok: false, method: config.wakeUrl.trim() ? "http-bridge" : null };
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

  if (wakeMethodsFor(config).length === 0) {
    const status = await computeHostStatus(config);
    return {
      id: config.id,
      accepted: false,
      method: null,
      reason: "not-configured",
      state: status.state,
      message: "No wake method is configured for this host.",
    };
  }
  if (!config.wakeEnabled) {
    const status = await computeHostStatus(config);
    return {
      id: config.id,
      accepted: false,
      method: null,
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
      method: null,
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
      method: null,
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
      method: null,
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

    const { ok: sent, method } = await sendWakeRequest(config);
    if (!sent) {
      stored.lastWakeOutcome = "failed";
      await savePersisted();
      console.warn(
        `[compute-host] wake request failed for ${config.id} via ${redactWakeUrl(config.wakeUrl)}`,
      );
      return {
        id: config.id,
        accepted: false,
        method,
        reason: "failed",
        state: "unreachable",
        message: "No wake method could deliver the request.",
      };
    }

    console.log(
      `[compute-host] wake sent for ${config.id} via ${method === "lan-magic-packet" ? "a LAN magic packet" : redactWakeUrl(config.wakeUrl)}, waiting for readiness`,
    );
    const outcome = await waitForReady(config);
    stored.lastWakeOutcome = outcome;
    await savePersisted();
    invalidate(config.id);
    const status = await computeHostStatus(config, { force: true });
    return {
      id: config.id,
      accepted: true,
      method,
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
  if (!config.autoWake || !config.wakeEnabled || wakeMethodsFor(config).length === 0) return null;
  const status = await computeHostStatus(config);
  if (isComputeHostOnline(status.state)) return null;
  return wakeComputeHost(config);
}
