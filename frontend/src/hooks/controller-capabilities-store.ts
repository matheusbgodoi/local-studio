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
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/api/connection";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type CapabilitiesSnapshot = {
  loading: boolean;
  capabilities: ControllerCapabilities;
};

const unknownFeatures = (): ControllerFeatures => ({
  config: "unknown",
  compatibility: "unknown",
  lifecycle: "unknown",
  recipes: "unknown",
  rigs: "unknown",
  logs: "unknown",
  openapi: "unknown",
  metrics: "unknown",
  metricsHistory: "unknown",
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
  recipes: "/recipes",
  rigs: "/studio/rigs",
  logs: "/logs",
  openapi: "/api/spec",
  metrics: "/v1/metrics/vllm",
  metricsHistory: "/metrics/history",
  usage: "/usage",
};

let snapshot: CapabilitiesSnapshot = {
  loading: false,
  capabilities: unknownCapabilities(),
};
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

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

const probeLegacyController = async (): Promise<ControllerCapabilities> => {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([feature, endpoint]) => [
      feature,
      await api.probeControllerCapability(endpoint),
    ]),
  );
  const probed = Object.fromEntries(entries) as Record<
    Exclude<keyof ControllerFeatures, "lifecycle">,
    CapabilityState
  >;
  const features: ControllerFeatures = {
    ...probed,
    lifecycle: probed.recipes,
  };
  return {
    schemaVersion: 1,
    controllerVersion: null,
    mode: inferredMode(features),
    features,
  };
};

export const refreshControllerCapabilities = (): Promise<void> => {
  if (inFlight) return inFlight;
  emit({ ...snapshot, loading: true });
  inFlight = (async () => {
    try {
      const declared = await api.getControllerCapabilities({ timeout: 3_000, retries: 0 });
      emit({
        loading: false,
        capabilities: Schema.decodeUnknownSync(ControllerCapabilitiesSchema)(declared),
      });
    } catch {
      emit({ loading: false, capabilities: await probeLegacyController() });
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

export const useControllerCapabilities = (): CapabilitiesSnapshot => {
  useMountSubscription(() => {
    void refreshControllerCapabilities();
    const reset = () => {
      emit({ loading: false, capabilities: unknownCapabilities() });
      void refreshControllerCapabilities();
    };
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, reset);
    return () => window.removeEventListener(BACKEND_URL_CHANGED_EVENT, reset);
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
};
