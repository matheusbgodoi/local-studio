"use client";

import { useSyncExternalStore } from "react";
import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/api/connection";
import {
  groupByPhysicalModel,
  normalizeOpenAIModels,
  type PhysicalModel,
} from "@/features/agent/models";

type ServedModelsState = {
  physicalModels: readonly PhysicalModel[];
  loading: boolean;
  error: string | null;
};

let state: ServedModelsState = { physicalModels: [], loading: true, error: null };
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ServedModelsState): void {
  state = next;
  for (const listener of listeners) listener();
}

export async function refreshServedModels(): Promise<void> {
  if (request) return request;
  publish({ ...state, loading: true });
  request = api
    .getOpenAIModels()
    .then((payload) => {
      publish({
        physicalModels: groupByPhysicalModel(normalizeOpenAIModels(payload)),
        loading: false,
        error: null,
      });
    })
    .catch((cause: unknown) => {
      publish({
        ...state,
        loading: false,
        error: cause instanceof Error ? cause.message : "Served models could not be read",
      });
    })
    .finally(() => {
      request = null;
    });
  return request;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) void refreshServedModels();
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, () => {
    state = { physicalModels: [], loading: true, error: null };
    void refreshServedModels();
  });
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
  return model?.displayName ?? null;
}
