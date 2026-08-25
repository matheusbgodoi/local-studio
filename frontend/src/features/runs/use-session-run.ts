"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { AgenticRun, AgenticRunSnapshot } from "@shared/agent/agentic-run";
import {
  getRunSnapshotState,
  getRunsState,
  subscribeRunSnapshot,
  subscribeRuns,
  type RunSnapshotState,
} from "./runs-store";

//
// The Run this conversation is driving, if any. Subscribing is what starts the
// store polling, so a chat that never becomes a Run costs one list request and
// then nothing.
//
// The association is the durable one the runtime wrote — `sessionId` /
// `piSessionId` on the run row. Nothing here matches on titles, prompts or
// recency: a Run belongs to the conversation that created it or to no
// conversation at all.
//

export type SessionRunState = {
  /** The run row this conversation owns, as the list reports it. */
  run: AgenticRun | null;
  /**
   * Its full snapshot, keyed by Run id so another chat or the Runs page cannot
   * replace it while this conversation is open.
   */
  snapshot: AgenticRunSnapshot | null;
  /** The first list request has not answered yet, so "no run" is not yet known. */
  loading: boolean;
};

export function useSessionRunState(
  sessionId: string | null | undefined,
  piSessionId: string | null | undefined,
): SessionRunState {
  const state = useSyncExternalStore(subscribeRuns, getRunsState, getRunsState);
  const run =
    state.runs.find(
      (entry) =>
        (sessionId && entry.sessionId === sessionId) ||
        (piSessionId && entry.piSessionId === piSessionId),
    ) ?? null;
  const snapshotState = useRunSnapshotState(run?.id ?? null);
  if (!run) return { run: null, snapshot: null, loading: state.loading };
  return {
    run,
    snapshot: snapshotState.snapshot?.run.id === run.id ? snapshotState.snapshot : null,
    loading: state.loading || snapshotState.loading,
  };
}

export function useRunSnapshotState(runId: string | null): RunSnapshotState {
  const subscribe = useCallback(
    (listener: () => void) => (runId ? subscribeRunSnapshot(runId, listener) : () => undefined),
    [runId],
  );
  const getSnapshot = useCallback(() => getRunSnapshotState(runId), [runId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSessionRun(
  sessionId: string | null | undefined,
  piSessionId: string | null | undefined,
): AgenticRunSnapshot | null {
  return useSessionRunState(sessionId, piSessionId).snapshot;
}
