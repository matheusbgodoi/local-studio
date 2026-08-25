"use client";

import { Effect } from "effect";
import type { AgenticRun, AgenticRunSnapshot } from "@shared/agent/agentic-run";
import {
  cancelRun,
  deleteRun,
  listRuns,
  loadRunSnapshot,
  resumeRun,
  setRunArchived,
} from "./runs-api";

//
// A Run advances whether or not anyone is looking at it, so its state lives in
// a module-level store the view subscribes to rather than in component effects.
// Polling follows the Run snapshots that currently have subscribers, and it
// never opens a second event stream: the session runtime controller owns
// runtime events, and a Run's progress is durable state a refresh can recover.
//

const POLL_MS = 2_000;
//
// The cadence used when nothing live is selected. A conversation that has no Run
// yet still has to DISCOVER one — the model can create a Run at any moment, and
// before this the store stopped polling entirely in that state, so the panel sat
// on "No durable Run for this conversation" until the page was reloaded. Slower
// than the live cadence because there is nothing changing to watch, only
// something to notice.
//
const IDLE_POLL_MS = 5_000;

export type RunsSnapshotState = {
  runs: readonly AgenticRun[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
};

export type RunSnapshotState = {
  snapshot: AgenticRunSnapshot | null;
  loading: boolean;
  error: string | null;
};

type RunSnapshotEntry = {
  state: RunSnapshotState;
  listeners: Set<() => void>;
  subscribers: number;
  request: Promise<void> | null;
};

let state: RunsSnapshotState = {
  runs: [],
  selectedId: null,
  loading: true,
  error: null,
};

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let timerInterval = 0;
let subscribers = 0;
const snapshots = new Map<string, RunSnapshotEntry>();
const emptySnapshotState: RunSnapshotState = { snapshot: null, loading: false, error: null };
const pendingSnapshotState: RunSnapshotState = { snapshot: null, loading: true, error: null };

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

function snapshotEntry(runId: string): RunSnapshotEntry {
  const current = snapshots.get(runId);
  if (current) return current;
  const next: RunSnapshotEntry = {
    state: { snapshot: null, loading: true, error: null },
    listeners: new Set(),
    subscribers: 0,
    request: null,
  };
  snapshots.set(runId, next);
  return next;
}

function publishSnapshot(entry: RunSnapshotEntry, next: Partial<RunSnapshotState>): void {
  entry.state = { ...entry.state, ...next };
  for (const listener of entry.listeners) listener();
}

export async function refreshRuns(): Promise<void> {
  try {
    const runs = await Effect.runPromise(listRuns());
    const selectedId = state.selectedId ?? (state.loading ? (runs[0]?.id ?? null) : null);
    publish({ runs, selectedId, error: null, loading: false });
    await Promise.all(
      [...snapshots.entries()]
        .filter(([, entry]) => entry.subscribers > 0)
        .map(([runId]) => refreshSnapshot(runId)),
    );
    syncTimer();
  } catch (cause) {
    publish({ error: failure(cause, "Failed to load runs"), loading: false });
  }
}

export async function refreshSnapshot(runId: string): Promise<void> {
  const entry = snapshotEntry(runId);
  if (entry.request) return entry.request;
  if (!entry.state.snapshot) publishSnapshot(entry, { loading: true, error: null });
  entry.request = Effect.runPromise(loadRunSnapshot(runId))
    .then((snapshot) => publishSnapshot(entry, { snapshot, loading: false, error: null }))
    .catch((cause) =>
      publishSnapshot(entry, {
        loading: false,
        error: failure(cause, "Failed to load this run"),
      }),
    )
    .finally(() => {
      entry.request = null;
      if (entry.subscribers === 0) snapshots.delete(runId);
    });
  return entry.request;
}

export function selectRun(runId: string | null): void {
  publish({ selectedId: runId });
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

export async function archiveSelectedRun(runId: string, archived: boolean): Promise<boolean> {
  try {
    await Effect.runPromise(setRunArchived(runId, archived));
    await refreshRuns();
    return true;
  } catch (cause) {
    publish({ error: failure(cause, "Failed to update the Run archive") });
    return false;
  }
}

export async function deleteSelectedRun(runId: string): Promise<void> {
  try {
    await Effect.runPromise(deleteRun(runId));
    snapshots.delete(runId);
    publish({ selectedId: null });
    await refreshRuns();
  } catch (cause) {
    publish({ error: failure(cause, "Failed to delete the Run") });
  }
}

function syncTimer(): void {
  const watchedLiveRun = [...snapshots.entries()].some(
    ([runId, entry]) => entry.subscribers > 0 && isLive(state.runs.find((run) => run.id === runId)),
  );
  //
  // Polling follows SUBSCRIBERS, not selection. Keying it on "a live run is
  // already selected" meant a chat with no Run never looked again, so a Run
  // created while that chat was open never appeared.
  //
  const wanted = subscribers > 0 || [...snapshots.values()].some((entry) => entry.subscribers > 0);
  const interval = watchedLiveRun ? POLL_MS : IDLE_POLL_MS;
  if (wanted && timerInterval === interval && timer !== null) return;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (!wanted) {
    timerInterval = 0;
    return;
  }
  timerInterval = interval;
  timer = setInterval(() => {
    void refreshRuns();
  }, interval);
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

export function subscribeRunSnapshot(runId: string, listener: () => void): () => void {
  const entry = snapshotEntry(runId);
  entry.listeners.add(listener);
  entry.subscribers += 1;
  if (entry.subscribers === 1) void refreshSnapshot(runId);
  syncTimer();
  return () => {
    entry.listeners.delete(listener);
    entry.subscribers = Math.max(0, entry.subscribers - 1);
    if (entry.subscribers === 0 && !entry.request) snapshots.delete(runId);
    syncTimer();
  };
}

export function getRunSnapshotState(runId: string | null): RunSnapshotState {
  if (!runId) return emptySnapshotState;
  return snapshots.get(runId)?.state ?? pendingSnapshotState;
}
