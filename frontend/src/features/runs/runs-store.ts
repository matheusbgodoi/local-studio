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
let timerInterval = 0;
let subscribers = 0;
let watching: string | null = null;

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
  } catch (cause) {
    //
    // A snapshot that never arrives used to leave a spinner with no
    // explanation, because only the list request reported anything.
    //
    if (state.selectedId === runId) {
      publish({ error: failure(cause, "Failed to load this run") });
    }
  }
}

//
// The chat panel follows whichever Run its conversation is driving. Selecting
// it here is what makes the store load and keep refreshing that snapshot; it is
// idempotent so a render can call it freely.
//
export function watchSessionRun(runId: string): void {
  if (state.selectedId === runId || watching === runId) return;
  //
  // Deferred out of the render pass that asked for it. Selecting synchronously
  // publishes, every subscriber re-renders, and two panes would fight over the
  // selection for as long as both are open.
  //
  watching = runId;
  queueMicrotask(() => {
    watching = null;
    if (state.selectedId === runId) return;
    selectRun(runId);
  });
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
  //
  // Polling follows SUBSCRIBERS, not selection. Keying it on "a live run is
  // already selected" meant a chat with no Run never looked again, so a Run
  // created while that chat was open never appeared.
  //
  const wanted = subscribers > 0;
  const interval = isLive(selected) ? POLL_MS : IDLE_POLL_MS;
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
