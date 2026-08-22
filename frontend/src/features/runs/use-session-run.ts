"use client";

import { useSyncExternalStore } from "react";
import type { AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { getRunsState, subscribeRuns, watchSessionRun } from "./runs-store";

//
// The Run this conversation is driving, if any. Subscribing is what starts the
// store polling, so a chat that never becomes a Run costs one list request and
// then nothing.
//
export function useSessionRun(
  sessionId: string | null | undefined,
  piSessionId: string | null | undefined,
): AgenticRunSnapshot | null {
  const state = useSyncExternalStore(subscribeRuns, getRunsState, getRunsState);
  const run = state.runs.find(
    (entry) =>
      (sessionId && entry.sessionId === sessionId) ||
      (piSessionId && entry.piSessionId === piSessionId),
  );
  if (!run) return null;
  watchSessionRun(run.id);
  return state.snapshot?.run.id === run.id ? state.snapshot : null;
}
