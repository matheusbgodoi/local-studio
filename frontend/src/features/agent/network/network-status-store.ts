"use client";

import { Effect } from "effect";
import type { NetworkPolicy, NetworkStatus } from "@shared/agent/network-policy";
import { loadNetworkStatus, requestNetworkPolicy, type NetworkPolicyOutcome } from "./network-api";

//
// The enforcement boundary is process-wide, so its state belongs to the machine
// and not to any one component. One module-level store polls it and every
// surface that shows a padlock — the composer control, the inline Run panel, the
// deep Run view — reads the same snapshot, which is what stops two of them from
// disagreeing about whether the tunnel is up.
//
// A QUIET DEFAULT STAYS QUIET. The overwhelmingly common case is a machine that
// never asked for protection: one read on first subscribe tells us the state is
// DIRECT, and after that nothing repeats. The timer starts only once protection
// is actually in play — asked for, in flight, or already reported as anything
// other than DIRECT — and stops again when it isn't.
//

const POLL_MS = 4_000;

export type NetworkStatusState = {
  status: NetworkStatus | null;
  loading: boolean;
  error: string | null;
};

let state: NetworkStatusState = {
  status: null,
  loading: true,
  error: null,
};

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;
let inFlightPolicyRequests = 0;
//
// Sticky for the lifetime of the page: once this machine has been asked for
// protection, its state can change under us (a tunnel dies, a handshake goes
// stale) even after the last protected conversation is closed, and a padlock
// that stops refreshing is worse than one that costs a request every 4s.
//
let protectionEverRequested = false;

function publish(next: Partial<NetworkStatusState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function failure(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function protectionInPlay(): boolean {
  if (protectionEverRequested || inFlightPolicyRequests > 0) return true;
  const status = state.status;
  if (!status) return false;
  return status.state !== "DIRECT" || status.protectedSessionCount > 0;
}

function syncTimer(): void {
  const wanted = subscribers > 0 && protectionInPlay();
  if (wanted && timer === null) {
    timer = setInterval(() => {
      void refreshNetworkStatus();
    }, POLL_MS);
    return;
  }
  if (!wanted && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export async function refreshNetworkStatus(): Promise<void> {
  try {
    const status = await Effect.runPromise(loadNetworkStatus());
    publish({ status, error: null, loading: false });
  } catch (cause) {
    //
    // The last known status is deliberately kept. Losing the reader is not the
    // same as losing the boundary, and blanking the panel would turn a failed
    // poll into an invented "unknown" state.
    //
    publish({ error: failure(cause, "Failed to read the network status"), loading: false });
  }
  syncTimer();
}

//
// Asks the runtime for a policy and reports what it answered. The caller must
// not move its own toggle until this resolves `accepted`: a refusal (no imported
// configuration) has to leave the conversation on "direct" and show the reason.
//
export async function setSessionNetworkPolicy(
  sessionId: string,
  policy: NetworkPolicy,
): Promise<NetworkPolicyOutcome> {
  if (policy === "vpn_protected") protectionEverRequested = true;
  inFlightPolicyRequests += 1;
  syncTimer();
  try {
    const outcome = await Effect.runPromise(requestNetworkPolicy(sessionId, policy));
    if (outcome.status) publish({ status: outcome.status, loading: false, error: null });
    return outcome;
  } catch (cause) {
    return {
      accepted: false,
      error: failure(cause, "Failed to set the network policy"),
      status: null,
    };
  } finally {
    inFlightPolicyRequests -= 1;
    syncTimer();
  }
}

//
// The subscription a surface uses when it ALREADY knows this machine is meant to
// be protected — a conversation restored from disk with `vpn_protected`, a Run
// carrying that policy. Subscribing through this door is what starts the timer,
// so a quiet machine that never asked for anything still never polls.
//
export function subscribeProtectedNetworkStatus(listener: () => void): () => void {
  protectionEverRequested = true;
  return subscribeNetworkStatus(listener);
}

export function subscribeNetworkStatus(listener: () => void): () => void {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) void refreshNetworkStatus();
  syncTimer();
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    syncTimer();
  };
}

export function getNetworkStatusState(): NetworkStatusState {
  return state;
}
