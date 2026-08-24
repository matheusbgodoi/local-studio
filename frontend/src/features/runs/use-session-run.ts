"use client";

import { useSyncExternalStore } from "react";
import type { AgenticRun, AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { getRunsState, subscribeRuns, watchSessionRun } from "./runs-store";

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
   * Its full snapshot, and only ever its own: the store holds one selection at
   * a time, so while a freshly focused conversation's Run is still loading this
   * is null rather than the previous conversation's Run.
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
  if (!run) return { run: null, snapshot: null, loading: state.loading };
  watchSessionRun(run.id);
  return {
    run,
    snapshot: state.snapshot?.run.id === run.id ? state.snapshot : null,
    loading: state.loading,
  };
}

export function useSessionRun(
  sessionId: string | null | undefined,
  piSessionId: string | null | undefined,
): AgenticRunSnapshot | null {
  return useSessionRunState(sessionId, piSessionId).snapshot;
}
