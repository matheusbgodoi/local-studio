"use client";

import { useSyncExternalStore } from "react";
import {
  getNetworkStatusState,
  subscribeNetworkStatus,
  subscribeProtectedNetworkStatus,
  type NetworkStatusState,
} from "./network-status-store";

//
// `protectionExpected` picks WHICH subscription is opened, and both functions
// are module-level so the choice is stable across renders. It is not a second
// signal to reconcile: a caller that already carries a protected policy needs
// the live state, and one that doesn't must not wake the poller.
//
export function useNetworkStatus(protectionExpected = false): NetworkStatusState {
  return useSyncExternalStore(
    protectionExpected ? subscribeProtectedNetworkStatus : subscribeNetworkStatus,
    getNetworkStatusState,
    getNetworkStatusState,
  );
}
