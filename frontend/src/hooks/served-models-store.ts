"use client";

import { useSyncExternalStore } from "react";
import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT, getStoredBackendUrl } from "@/lib/api/connection";
import {
  groupByPhysicalModel,
  normalizeOpenAIModels,
  type PhysicalModel,
} from "@/features/agent/models";

type ServedModelsState = {
  physicalModels: readonly PhysicalModel[];
  loading: boolean;
  stale: boolean;
  error: string | null;
  controllerKey: string;
};

let state: ServedModelsState = {
  physicalModels: [],
  loading: true,
  stale: false,
  error: null,
  controllerKey: "default",
};
let request: { key: string; promise: Promise<void> } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const knownByController = new Map<string, readonly PhysicalModel[]>();

function scheduleRetry(): void {
  if (retryTimer || listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void refreshServedModels();
  }, 5_000);
}

function publish(next: ServedModelsState): void {
  state = next;
  for (const listener of listeners) listener();
}

export async function refreshServedModels(): Promise<void> {
  const key = currentControllerKey();
  if (request?.key === key) return request.promise;
  const requestGeneration = ++generation;
  const cached = knownByController.get(key);
  publish({
    physicalModels: cached ?? [],
    loading: true,
    stale: cached !== undefined,
    error: null,
    controllerKey: key,
  });
  const promise = api
    .getOpenAIModels({ timeout: 5_000, retries: 0 })
    .then((payload) => {
      if (requestGeneration !== generation || key !== currentControllerKey()) return;
      const physicalModels = groupByPhysicalModel(normalizeOpenAIModels(payload));
      knownByController.set(key, physicalModels);
      publish({
        physicalModels,
        loading: false,
        stale: false,
        error: null,
        controllerKey: key,
      });
    })
    .catch((cause: unknown) => {
      if (requestGeneration !== generation || key !== currentControllerKey()) return;
      const lastKnown = knownByController.get(key);
      publish({
        physicalModels: lastKnown ?? [],
        loading: false,
        stale: lastKnown !== undefined,
        error: cause instanceof Error ? cause.message : "Served models could not be read",
        controllerKey: key,
      });
      scheduleRetry();
    })
    .finally(() => {
      if (request?.promise === promise) request = null;
    });
  request = { key, promise };
  return promise;
}

function currentControllerKey(): string {
  return getStoredBackendUrl() || "default";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, resetForController);
    void refreshServedModels();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener(BACKEND_URL_CHANGED_EVENT, resetForController);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}

function resetForController(): void {
  generation += 1;
  request = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const key = currentControllerKey();
  const cached = knownByController.get(key);
  publish({
    physicalModels: cached ?? [],
    loading: true,
    stale: cached !== undefined,
    error: null,
    controllerKey: key,
  });
  if (listeners.size > 0) void refreshServedModels();
}

export function useServedModels(): ServedModelsState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function displayNameForModel(
  physicalModels: readonly PhysicalModel[],
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null;
  const model = physicalModels.find(
    (candidate) =>
      candidate.physicalModelId === modelId ||
      candidate.profiles.some((profile) => profile.id === modelId),
  );
  return (
    model?.profiles
      .map((profile) => profile.displayName?.trim())
      .find((displayName): displayName is string => Boolean(displayName)) ?? null
  );
}

export function physicalIdForModel(
  physicalModels: readonly PhysicalModel[],
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null;
  const model = physicalModels.find(
    (candidate) =>
      candidate.physicalModelId === modelId ||
      candidate.profiles.some((profile) => profile.id === modelId),
  );
  return model?.physicalModelId ?? modelId;
}
