"use client";

import { Effect } from "effect";
import type { AgenticRun, AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { cancelRun, listRuns, loadRunSnapshot, resumeRun } from "./runs-api";

//
// A Run advances whether or not anyone is looking at it, so its state lives in
// a module-level store the view subscribes to rather than in component effects.
// Polling stops as soon as the selected Run reaches a state that cannot change
// on its own, and it never opens a second event stream: the session runtime
// controller owns runtime events, and a Run's progress is durable state a
// refresh can always recover.
//

const POLL_MS = 2_000;

export type RunsSnapshotState = {
  runs: readonly AgenticRun[];
  snapshot: AgenticRunSnapshot | null;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
};

let state: RunsSnapshotState = {
  runs: [],
  snapshot: null,
  selectedId: null,
  loading: true,
  error: null,
};

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

function publish(next: Partial<RunsSnapshotState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

const isLive = (run: AgenticRun | undefined): boolean =>
  run !== undefined &&
  (run.status === "RUNNING" || run.status === "PLANNING" || run.status === "COMPLETING");

function failure(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export async function refreshRuns(): Promise<void> {
  try {
    const runs = await Effect.runPromise(listRuns());
    const selectedId = state.selectedId ?? runs[0]?.id ?? null;
    publish({ runs, selectedId, error: null, loading: false });
    if (selectedId) await refreshSnapshot(selectedId);
    syncTimer();
  } catch (cause) {
    publish({ error: failure(cause, "Failed to load runs"), loading: false });
  }
}

export async function refreshSnapshot(runId: string): Promise<void> {
  try {
    const snapshot = await Effect.runPromise(loadRunSnapshot(runId));
    if (state.selectedId === runId) publish({ snapshot });
  } catch {
    // A snapshot that fails to load leaves the previous one on screen; the
    // list request is what reports an outage.
  }
}

export function selectRun(runId: string): void {
  publish({ selectedId: runId, snapshot: null });
  void refreshSnapshot(runId);
  syncTimer();
}

export async function resumeSelectedRun(runId: string): Promise<void> {
  try {
    await Effect.runPromise(resumeRun(runId));
    await refreshRuns();
  } catch (cause) {
    publish({ error: failure(cause, "Failed to resume the run") });
  }
}

export async function cancelSelectedRun(runId: string): Promise<void> {
  try {
    await Effect.runPromise(cancelRun(runId));
    await refreshRuns();
  } catch (cause) {
    publish({ error: failure(cause, "Failed to cancel the run") });
  }
}

function syncTimer(): void {
  const selected = state.runs.find((run) => run.id === state.selectedId);
  const wanted = subscribers > 0 && isLive(selected);
  if (wanted && timer === null) {
    timer = setInterval(() => {
      void refreshRuns();
    }, POLL_MS);
    return;
  }
  if (!wanted && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function subscribeRuns(listener: () => void): () => void {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) void refreshRuns();
  syncTimer();
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    syncTimer();
  };
}

export function getRunsState(): RunsSnapshotState {
  return state;
}
