"use client";

// THE single owner of controller-level status: reachability, running process,
// GPUs, metrics, launch progress, runtime summary. Fed by the controller SSE
// (vllm:controller-event, dispatched by use-controller-events) with a 5s
// poll+backoff fallback. Views derive from the snapshot via
// realtime-status-types.ts — nothing else may poll getStatus or listen to
// controller events for status.

import { useSyncExternalStore } from "react";
import { Effect, Result } from "effect";
import { effectInterval, effectTimeout, type EffectTimer } from "@/lib/effect-timers";
import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimeBackendInfo,
} from "@/lib/types";

import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/api/connection";
import { normalizeGpuAliases } from "@/lib/api/system";
import { captureControllerIdentity, type ControllerIdentity } from "@/lib/controller-identity";
import {
  areGpusEqual,
  areLaunchProgressEqual,
  areLeasesEqual,
  areMetricsEqual,
  arePlatformKindsEqual,
  areRuntimeSummariesEqual,
  areServicesEqual,
  areStatusEqual,
} from "./realtime-status-equality";
import {
  isActiveLaunchStage,
  type LeaseInfo,
  type RealtimeStatusSnapshot,
  type RuntimeSummaryData,
  type ServiceEntry,
} from "./realtime-status-types";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_COMPAT_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_GPU_REQUEST = { timeout: 5_000, retries: 0 } as const;

type ControllerEventDetail = ControllerIdentity & {
  type?: string;
  data?: Record<string, unknown>;
};
type PolledStatus = Awaited<ReturnType<typeof api.getStatus>>;
type PolledCompatibility = Awaited<ReturnType<typeof api.getCompatibility>>;
type PolledGpus = { gpus: GPU[]; observedAt: number };
type PolledMetrics = { metrics: Metrics | null; observedAt: number };
type PollResults = {
  compatibility: PolledCompatibility | null;
  gpus: GPU[];
  gpusObservedAt: number;
  metrics: Metrics | null;
  metricsObservedAt: number;
  status: PolledStatus | null;
  statusConnected: boolean;
};

const unavailableBackend = (): RuntimeBackendInfo => ({
  installed: false,
  version: null,
});

function normalizeRuntimeBackends(
  backends: Partial<RuntimeSummaryData["backends"]> | null | undefined,
): RuntimeSummaryData["backends"] {
  return {
    vllm: backends?.vllm ?? unavailableBackend(),
    sglang: backends?.sglang ?? unavailableBackend(),
    llamacpp: backends?.llamacpp ?? unavailableBackend(),
    ...(backends?.mlx ? { mlx: backends.mlx } : {}),
  };
}

const initialSnapshot: RealtimeStatusSnapshot = {
  status: null,
  statusLoading: true,
  connected: false,
  gpus: [],
  metrics: null,
  launchProgress: null,
  platformKind: null,
  runtimeSummary: null,
  services: [],
  lease: null,
  gpusObservedAt: 0,
  metricsObservedAt: 0,
  lastEventAt: 0,
};

let snapshot: RealtimeStatusSnapshot = initialSnapshot;
const snapshotsByController = new Map<string, RealtimeStatusSnapshot>();
const listeners = new Set<() => void>();
let started = false;
let clearLaunchTimer: EffectTimer | null = null;
let pollFailureStreak = 0;
let pollBackoffUntil = 0;
let activeControllerIdentity = captureControllerIdentity();
let activeControllerKey = activeControllerIdentity.controllerKey;
let statusRequestSeq = 0;
let eventEpoch = 0;

const POLL_BASE_INTERVAL_MS = 5_000;
const POLL_MAX_BACKOFF_MS = 30_000;

function notePollOutcome(connected: boolean) {
  if (connected) {
    pollFailureStreak = 0;
    pollBackoffUntil = 0;
    return;
  }
  pollFailureStreak = Math.min(pollFailureStreak + 1, 6);
  const backoff = Math.min(
    POLL_MAX_BACKOFF_MS,
    POLL_BASE_INTERVAL_MS * 2 ** (pollFailureStreak - 1),
  );
  pollBackoffUntil = Date.now() + backoff;
}

function cacheActiveSnapshot(): void {
  snapshotsByController.set(activeControllerKey, snapshot);
}

function processKey(process: ProcessInfo | null | undefined): string {
  if (!process) return "";
  return [
    process.pid,
    process.backend,
    process.port,
    process.served_model_name ?? "",
    process.model_path ?? "",
    process.started_at ?? "unknown-start",
  ].join("|");
}

function sameProcess(
  first: ProcessInfo | null | undefined,
  second: ProcessInfo | null | undefined,
): boolean {
  return Boolean(first && second) && processKey(first) === processKey(second);
}

function identityParts(values: Array<string | null | undefined>): Set<string> {
  const parts = values.flatMap((value) => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return [];
    const basename = normalized.replace(/\\/g, "/").replace(/\/+$/, "").split("/").at(-1);
    return basename && basename !== normalized ? [normalized, basename] : [normalized];
  });
  return new Set(parts);
}

function metricsBelongToProcess(metrics: Metrics, process: ProcessInfo | null): boolean {
  if (!process) return false;
  const processIds = identityParts([process.served_model_name, process.model_path]);
  const metricIds = identityParts([
    metrics.model_id,
    metrics.served_model_name,
    metrics.model_path,
  ]);
  if (processIds.size === 0 || metricIds.size === 0) return false;
  return [...metricIds].some((id) => processIds.has(id));
}

function emitIfChanged(next: RealtimeStatusSnapshot) {
  const changed =
    !areStatusEqual(snapshot.status, next.status) ||
    snapshot.statusLoading !== next.statusLoading ||
    snapshot.connected !== next.connected ||
    !areGpusEqual(snapshot.gpus, next.gpus) ||
    !areMetricsEqual(snapshot.metrics, next.metrics) ||
    !areLaunchProgressEqual(snapshot.launchProgress, next.launchProgress) ||
    !arePlatformKindsEqual(snapshot.platformKind, next.platformKind) ||
    !areRuntimeSummariesEqual(snapshot.runtimeSummary, next.runtimeSummary) ||
    !areServicesEqual(snapshot.services, next.services) ||
    !areLeasesEqual(snapshot.lease, next.lease) ||
    snapshot.gpusObservedAt !== next.gpusObservedAt ||
    snapshot.metricsObservedAt !== next.metricsObservedAt;

  snapshot = changed ? next : { ...snapshot, lastEventAt: next.lastEventAt };
  cacheActiveSnapshot();
  if (!changed) return;

  for (const l of listeners) l();
}

function reconcileLaunchProgress(
  progress: LaunchProgressData | null,
  status: { process: ProcessInfo | null; launching: string | null } | null,
): LaunchProgressData | null {
  if (!progress || !isActiveLaunchStage(progress.stage)) return progress;
  if (!status) return progress;
  if (status.process || status.launching) return progress;
  return null;
}

function scheduleLaunchClear(stage: LaunchProgressData["stage"]) {
  clearLaunchTimer?.cancel();
  clearLaunchTimer = null;
  if (stage === "ready" || stage === "error" || stage === "cancelled") {
    clearLaunchTimer = effectTimeout(() => {
      emitIfChanged({
        ...snapshot,
        launchProgress: null,
        lastEventAt: Date.now(),
      });
    }, 5000);
  }
}

function emitStatusLoading() {
  if (snapshot.statusLoading) return;
  emitIfChanged({
    ...snapshot,
    statusLoading: true,
    lastEventAt: Date.now(),
  });
}

const requestEffect = <T>(load: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.tryPromise({ try: load, catch: (error) => error });

function fetchPollResultsEffect(): Effect.Effect<PollResults> {
  return Effect.gen(function* () {
    const [statusResult, compatibilityResult, gpuResult, metricsResult] = yield* Effect.all([
      Effect.result(requestEffect(() => api.getStatus(FAST_STATUS_REQUEST))),
      Effect.result(requestEffect(() => api.getCompatibility(FAST_COMPAT_REQUEST))),
      Effect.result(
        requestEffect(async () => {
          const payload = await api.getGPUs(FAST_GPU_REQUEST);
          return { gpus: payload.gpus ?? [], observedAt: Date.now() } satisfies PolledGpus;
        }),
      ),
      Effect.result(
        requestEffect(async () => {
          const metrics = await api.getMetrics();
          return { metrics, observedAt: Date.now() } satisfies PolledMetrics;
        }),
      ),
    ] as const);
    const status = Result.isSuccess(statusResult) ? statusResult.success : null;
    const polledMetrics = pollMetrics(metricsResult, status);
    const polledGpus = Result.isSuccess(gpuResult)
      ? gpuResult.success
      : { gpus: snapshot.gpus, observedAt: snapshot.gpusObservedAt };
    return {
      compatibility: Result.isSuccess(compatibilityResult) ? compatibilityResult.success : null,
      gpus: polledGpus.gpus,
      gpusObservedAt: polledGpus.observedAt,
      metrics: polledMetrics.metrics,
      metricsObservedAt: polledMetrics.observedAt,
      status,
      statusConnected: Result.isSuccess(statusResult),
    };
  });
}

function pollMetrics(
  result: Result.Result<PolledMetrics, unknown>,
  status: PolledStatus | null,
): { metrics: Metrics | null; observedAt: number } {
  if (Result.isSuccess(result)) {
    const { metrics, observedAt } = result.success;
    return metrics && metricsBelongToProcess(metrics, status?.process ?? null)
      ? { metrics, observedAt }
      : { metrics: null, observedAt: 0 };
  }
  return sameProcess(snapshot.status?.process, status?.process)
    ? { metrics: snapshot.metrics, observedAt: snapshot.metricsObservedAt }
    : { metrics: null, observedAt: 0 };
}

function fallbackRuntimeVendor(
  kind: RuntimeSummaryData["platform"]["kind"] | null | undefined,
): RuntimeSummaryData["platform"]["vendor"] {
  if (kind === "cuda") return "nvidia";
  if (kind === "rocm") return "amd";
  if (kind === "metal") return "apple";
  return null;
}

function runtimeSummaryFromCompatibility(
  current: RuntimeSummaryData | null,
  compatibility: PolledCompatibility | null,
): RuntimeSummaryData | null {
  if (current || !compatibility) return current;
  const kind = compatibility.platform.kind;
  return {
    platform: { kind, vendor: fallbackRuntimeVendor(kind) },
    gpu_monitoring: compatibility.gpu_monitoring,
    backends: normalizeRuntimeBackends(compatibility.backends),
  };
}

function emitNoPolledStatus(gpus: GPU[], gpusObservedAt: number) {
  // Keep a warm cache through transient navigation/SSE handoff failures. The
  // next poll failure marks the controller offline, but a single missed fast
  // request should not blank the status page or flash "offline".
  const hasCachedStatus = Boolean(
    snapshot.status || snapshot.runtimeSummary || snapshot.gpus.length,
  );
  emitIfChanged({
    ...snapshot,
    statusLoading: false,
    connected: hasCachedStatus && pollFailureStreak <= 3 ? snapshot.connected : false,
    gpus,
    gpusObservedAt,
    lastEventAt: Date.now(),
  });
}

function emitPolledStatus({
  compatibility,
  gpus,
  gpusObservedAt,
  metrics,
  metricsObservedAt,
  status,
}: PollResults) {
  if (!status) return emitNoPolledStatus(gpus, gpusObservedAt);
  const { running, process, inference_port } = status;
  const launching = status.launching ?? null;
  emitIfChanged({
    status: { running, process, inference_port, launching },
    statusLoading: false,
    connected: true,
    gpus,
    metrics,
    launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
      process: process ?? null,
      launching,
    }),
    platformKind: compatibility?.platform?.kind ?? snapshot.platformKind,
    runtimeSummary: runtimeSummaryFromCompatibility(snapshot.runtimeSummary, compatibility),
    services: snapshot.services,
    lease: snapshot.lease,
    gpusObservedAt,
    metricsObservedAt,
    lastEventAt: Date.now(),
  });
}

function statusFromEventData(
  data: Record<string, unknown>,
): NonNullable<RealtimeStatusSnapshot["status"]> {
  const process = (data["process"] ?? null) as ProcessInfo | null;
  return {
    running: Boolean(data["running"] ?? process),
    process,
    inference_port: Number(data["inference_port"] ?? 8000),
    launching:
      typeof data["launching"] === "string" && data["launching"] ? data["launching"] : null,
  };
}

function metricsForEventProcess(process: ProcessInfo | null): Metrics | null {
  return sameProcess(snapshot.status?.process, process) ? snapshot.metrics : null;
}

function handleStatusEvent(data: Record<string, unknown>, now: number) {
  // A live status event means the selected backend is reachable; clear any
  // poll backoff so a recovered connection resumes fast polling.
  notePollOutcome(true);
  const status = statusFromEventData(data);
  const processUnchanged = sameProcess(snapshot.status?.process, status.process);
  emitIfChanged({
    ...snapshot,
    status,
    statusLoading: false,
    connected: true,
    metrics: metricsForEventProcess(status.process),
    metricsObservedAt: processUnchanged ? snapshot.metricsObservedAt : 0,
    launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
      process: status.process,
      launching: status.launching,
    }),
    lastEventAt: now,
  });
}

function handleGpuEvent(data: Record<string, unknown>, now: number) {
  emitIfChanged({
    ...snapshot,
    gpus: normalizeGpuAliases(data["gpus"]),
    gpusObservedAt: now,
    lastEventAt: now,
  });
}

function handleMetricsEvent(data: Record<string, unknown>, now: number) {
  const metrics = data as Metrics;
  if (!metricsBelongToProcess(metrics, snapshot.status?.process ?? null)) return;
  emitIfChanged({
    ...snapshot,
    metrics,
    metricsObservedAt: now,
    lastEventAt: now,
  });
}

function handleLaunchProgressEvent(data: Record<string, unknown>, now: number) {
  const progress = data as unknown as LaunchProgressData;
  scheduleLaunchClear(progress.stage);
  emitIfChanged({
    ...snapshot,
    // A live launch event proves the controller is reachable even before the
    // first successful status poll.
    connected: true,
    launchProgress: progress,
    lastEventAt: now,
  });
}

type RuntimeSummaryEventPlatform = { kind?: string; vendor?: string | null };
const RUNTIME_PLATFORM_KINDS = new Set<RuntimeSummaryData["platform"]["kind"]>([
  "cuda",
  "rocm",
  "metal",
  "unknown",
]);
const RUNTIME_PLATFORM_VENDORS = new Set<Exclude<RuntimeSummaryData["platform"]["vendor"], null>>([
  "nvidia",
  "amd",
  "apple",
]);

function handleRuntimeSummaryEvent(data: Record<string, unknown>, now: number) {
  const platform = data["platform"] as RuntimeSummaryEventPlatform | undefined;
  const nextKind =
    platform?.kind &&
    RUNTIME_PLATFORM_KINDS.has(platform.kind as RuntimeSummaryData["platform"]["kind"])
      ? (platform.kind as RuntimeSummaryData["platform"]["kind"])
      : snapshot.platformKind;
  const nextVendor =
    platform?.vendor &&
    RUNTIME_PLATFORM_VENDORS.has(
      platform.vendor as Exclude<RuntimeSummaryData["platform"]["vendor"], null>,
    )
      ? (platform.vendor as Exclude<RuntimeSummaryData["platform"]["vendor"], null>)
      : fallbackRuntimeVendor(nextKind);
  const gpuMon = data["gpu_monitoring"] as RuntimeSummaryData["gpu_monitoring"] | undefined;
  const backends = data["backends"] as Partial<RuntimeSummaryData["backends"]> | undefined;
  const rawServices = data["services"] as ServiceEntry[] | undefined;
  const rawLease = data["lease"] as LeaseInfo | undefined;

  emitIfChanged({
    status: snapshot.status,
    statusLoading: snapshot.statusLoading,
    connected: snapshot.connected,
    gpus: snapshot.gpus,
    metrics: snapshot.metrics,
    launchProgress: snapshot.launchProgress,
    platformKind: nextKind,
    runtimeSummary:
      platform && gpuMon && backends
        ? {
            platform: { kind: nextKind ?? "unknown", vendor: nextVendor },
            gpu_monitoring: gpuMon,
            backends: normalizeRuntimeBackends(backends),
          }
        : snapshot.runtimeSummary,
    services: Array.isArray(rawServices) ? rawServices : snapshot.services,
    lease: rawLease ?? snapshot.lease,
    gpusObservedAt: snapshot.gpusObservedAt,
    metricsObservedAt: snapshot.metricsObservedAt,
    lastEventAt: now,
  });
}

const controllerEventHandlers: Record<
  string,
  (data: Record<string, unknown>, now: number) => void
> = {
  status: handleStatusEvent,
  gpu: handleGpuEvent,
  metrics: handleMetricsEvent,
  launch_progress: handleLaunchProgressEvent,
  runtime_summary: handleRuntimeSummaryEvent,
};

function handleControllerEvent(detail: ControllerEventDetail | undefined) {
  if (
    !detail ||
    detail.controllerKey !== activeControllerIdentity.controllerKey ||
    detail.generation !== activeControllerIdentity.generation
  ) {
    return;
  }
  const handler = controllerEventHandlers[detail.type ?? ""];
  if (!handler) return;
  eventEpoch += 1;
  handler(detail.data ?? {}, Date.now());
}

function fetchStatusNow(identity = activeControllerIdentity): Promise<void> {
  return Effect.runPromise(fetchStatusNowEffect(identity));
}

function fetchStatusNowEffect(identity = activeControllerIdentity): Effect.Effect<void> {
  return Effect.gen(function* () {
    const requestSeq = ++statusRequestSeq;
    const requestEventEpoch = eventEpoch;
    if (
      identity.controllerKey !== activeControllerIdentity.controllerKey ||
      identity.generation !== activeControllerIdentity.generation
    ) {
      return;
    }
    emitStatusLoading();
    const results = yield* fetchPollResultsEffect();
    if (
      identity.controllerKey !== activeControllerIdentity.controllerKey ||
      identity.generation !== activeControllerIdentity.generation ||
      requestSeq !== statusRequestSeq ||
      requestEventEpoch !== eventEpoch
    ) {
      return;
    }
    notePollOutcome(results.statusConnected);
    emitPolledStatus(results);
  });
}

function resetForControllerSwitch() {
  cacheActiveSnapshot();
  activeControllerIdentity = captureControllerIdentity();
  activeControllerKey = activeControllerIdentity.controllerKey;
  statusRequestSeq += 1;
  eventEpoch += 1;
  pollFailureStreak = 0;
  pollBackoffUntil = 0;
  clearLaunchTimer?.cancel();
  clearLaunchTimer = null;
  const cached = snapshotsByController.get(activeControllerKey);
  emitIfChanged({
    ...(cached ?? initialSnapshot),
    statusLoading: true,
    lastEventAt: Date.now(),
  });
  void fetchStatusNow(activeControllerIdentity);
}

function start() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  const onControllerEvent = (event: Event) => {
    handleControllerEvent((event as CustomEvent<ControllerEventDetail>).detail);
  };

  window.addEventListener("vllm:controller-event", onControllerEvent as EventListener);
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, resetForControllerSwitch);

  // Initial fetch + polling fallback in case SSE is blocked. The poll body
  // checks the SSE freshness window and backoff gate before firing.
  void fetchStatusNow();
  effectInterval(() => {
    const now = Date.now();
    if (now - snapshot.lastEventAt < 10_000) return;
    if (now < pollBackoffUntil) return;
    void fetchStatusNow();
  }, POLL_BASE_INTERVAL_MS);

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      void fetchStatusNow();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) void fetchStatusNow();
  };
  window.addEventListener("pageshow", onPageShow);
}

export function useRealtimeStatusStore(): RealtimeStatusSnapshot {
  start();
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => snapshot,
    () => initialSnapshot,
  );
}
