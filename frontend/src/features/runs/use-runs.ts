"use client";

import { useSyncExternalStore } from "react";
import { getRunsState, subscribeRuns, type RunsSnapshotState } from "./runs-store";

export function useRuns(): RunsSnapshotState {
  return useSyncExternalStore(subscribeRuns, getRunsState, getRunsState);
}
