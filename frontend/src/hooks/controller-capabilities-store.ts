"use client";

import { Schema } from "effect";
import { useSyncExternalStore } from "react";
import {
  ControllerCapabilitiesSchema,
  type CapabilityState,
  type ControllerCapabilities,
  type ControllerFeatures,
} from "@local-studio/contracts/capabilities";
import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT, getStoredBackendUrl } from "@/lib/api/connection";

type CapabilitiesSnapshot = {
  loading: boolean;
  stale: boolean;
  error: string | null;
  controllerKey: string;
  capabilities: ControllerCapabilities;
};

const unknownFeatures = (): ControllerFeatures => ({
  config: "unknown",
  compatibility: "unknown",
  lifecycle: "unknown",
  catalog: "unknown",
  modelIndex: "unknown",
  downloadQueue: "unknown",
  recipes: "unknown",
  rigs: "unknown",
  logs: "unknown",
  openapi: "unknown",
  metrics: "unknown",
  metricsHistory: "unknown",
  runtimeManagement: "unknown",
  usage: "unknown",
});

const unknownCapabilities = (): ControllerCapabilities => ({
  schemaVersion: 1,
  controllerVersion: null,
  mode: "legacy",
  features: unknownFeatures(),
});

const endpoints: Record<Exclude<keyof ControllerFeatures, "lifecycle">, string> = {
  config: "/config",
  compatibility: "/compat",
  catalog: "/v1/studio/models",
  modelIndex: "/studio/model-index",
  downloadQueue: "/studio/downloads",
  recipes: "/recipes",
  rigs: "/studio/rigs",
  logs: "/logs",
  openapi: "/api/spec",
  metrics: "/v1/metrics/vllm",
  metricsHistory: "/metrics/history",
  runtimeManagement: "/runtime/targets",
  usage: "/usage",
};

let snapshot: CapabilitiesSnapshot = {
  loading: true,
  stale: false,
  error: null,
  controllerKey: "default",
  capabilities: unknownCapabilities(),
};
let inFlight: { key: string; promise: Promise<void> } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const knownByController = new Map<string, ControllerCapabilities>();

function currentControllerKey(): string {
  return getStoredBackendUrl() || "default";
}

function scheduleRetry(): void {
  if (retryTimer || listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void refreshControllerCapabilities();
  }, 3_000);
}

const emit = (next: CapabilitiesSnapshot): void => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const inferredMode = (features: ControllerFeatures): ControllerCapabilities["mode"] => {
  const states = Object.values(features);
  if (states.every((state) => state === "unknown")) return "legacy";
  return features.config === "supported" && features.recipes === "supported"
    ? "full"
    : "inference-gateway";
};

const probeLegacyFeature = async (
  feature: Exclude<keyof ControllerFeatures, "lifecycle">,
  endpoint: string,
): Promise<CapabilityState> => {
  if (feature !== "logs") return api.probeControllerCapability(endpoint);
  try {
    const payload = await api.getLogSessions({ timeout: 3_000, retries: 0 });
    return Array.isArray(payload.sessions) ? "supported" : "unsupported";
  } catch {
    const transport = await api.probeControllerCapability(endpoint);
    return transport === "supported" ? "unsupported" : transport;
  }
};

const probeLegacyController = async (): Promise<ControllerCapabilities> => {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([feature, endpoint]) => [
      feature,
      await probeLegacyFeature(feature as Exclude<keyof ControllerFeatures, "lifecycle">, endpoint),
    ]),
  );
  const probed = Object.fromEntries(entries) as Record<
    Exclude<keyof ControllerFeatures, "lifecycle">,
    CapabilityState
  >;
  const features: ControllerFeatures = {
    ...probed,
    lifecycle: "unknown",
  };
  return {
    schemaVersion: 1,
    controllerVersion: null,
    mode: inferredMode(features),
    features,
  };
};

export const refreshControllerCapabilities = (): Promise<void> => {
  const key = currentControllerKey();
  if (inFlight?.key === key) return inFlight.promise;
  const requestGeneration = ++generation;
  const cached = knownByController.get(key);
  emit({
    loading: true,
    stale: cached !== undefined,
    error: null,
    controllerKey: key,
    capabilities: cached ?? unknownCapabilities(),
  });
  const promise = (async () => {
    try {
      const declared = await api.getControllerCapabilities({ timeout: 3_000, retries: 0 });
      if (requestGeneration !== generation || key !== currentControllerKey()) return;
      const capabilities = Schema.decodeUnknownSync(ControllerCapabilitiesSchema)(declared);
      knownByController.set(key, capabilities);
      emit({
        loading: false,
        stale: false,
        error: null,
        controllerKey: key,
        capabilities,
      });
    } catch (cause) {
      let capabilities: ControllerCapabilities;
      try {
        capabilities = await probeLegacyController();
      } catch {
        capabilities = unknownCapabilities();
      }
      if (requestGeneration !== generation || key !== currentControllerKey()) return;
      const hasKnownFeature = Object.values(capabilities.features).some(
        (feature) => feature !== "unknown",
      );
      if (hasKnownFeature) knownByController.set(key, capabilities);
      const lastKnown = knownByController.get(key);
      emit({
        loading: false,
        stale: !hasKnownFeature && lastKnown !== undefined,
        error: hasKnownFeature
          ? null
          : cause instanceof Error
            ? cause.message
            : "Controller capabilities are unavailable",
        controllerKey: key,
        capabilities: hasKnownFeature ? capabilities : (lastKnown ?? capabilities),
      });
      if (!hasKnownFeature) scheduleRetry();
    }
  })().finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { key, promise };
  return promise;
};

export const useControllerCapabilities = (): CapabilitiesSnapshot => {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
};

function resetForController(): void {
  generation += 1;
  inFlight = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const key = currentControllerKey();
  const cached = knownByController.get(key);
  emit({
    loading: true,
    stale: cached !== undefined,
    error: null,
    controllerKey: key,
    capabilities: cached ?? unknownCapabilities(),
  });
  if (listeners.size > 0) void refreshControllerCapabilities();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, resetForController);
    void refreshControllerCapabilities();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener(BACKEND_URL_CHANGED_EVENT, resetForController);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}
