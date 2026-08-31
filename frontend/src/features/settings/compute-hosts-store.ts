"use client";

import type { ComputeHostStatus } from "@shared/agent/compute-host";

//
// A compute host changes on its own schedule — it sleeps, it wakes, someone
// starts a game on it — so its state lives in a module-level store the section
// subscribes to. Polling runs only while something is watching, and a wake that
// is in flight is polled faster because that is the one moment the value is
// expected to move.
//

export type { ComputeHostStatus } from "@shared/agent/compute-host";

export type ComputeHostsState = {
  hosts: readonly ComputeHostStatus[] | null;
  busyHostId: string | null;
  notice: { text: string; tone: "info" | "danger" } | null;
};

const IDLE_POLL_MS = 20_000;
const ACTIVE_POLL_MS = 4_000;

let state: ComputeHostsState = { hosts: null, busyHostId: null, notice: null };
const listeners = new Set<() => void>();
let subscribers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

function emit(next: ComputeHostsState): void {
  state = next;
  for (const listener of listeners) listener();
}

function anyWakeInFlight(): boolean {
  return (state.hosts ?? []).some((host) => host.wakeInFlight) || state.busyHostId !== null;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  if (subscribers === 0) {
    timer = null;
    return;
  }
  timer = setTimeout(
    () => void refreshComputeHosts(),
    anyWakeInFlight() ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  );
}

export function refreshComputeHosts(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch("/api/agent/compute-hosts", { cache: "no-store" });
      const body = (await response.json()) as { hosts?: ComputeHostStatus[] };
      emit({ ...state, hosts: body.hosts ?? [] });
    } catch {
      emit({ ...state, hosts: state.hosts ?? [] });
    } finally {
      inFlight = null;
      schedule();
    }
  })();
  return inFlight;
}

export function subscribeComputeHosts(listener: () => void): () => void {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) {
    if (state.hosts === null) void refreshComputeHosts();
    else schedule();
  }
  return () => {
    listeners.delete(listener);
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function getComputeHostsState(): ComputeHostsState {
  return state;
}

export async function patchComputeHost(id: string, patch: Record<string, unknown>): Promise<void> {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ computeHosts: [{ id, ...patch }] }),
  });
  await refreshComputeHosts();
}

export async function wakeComputeHost(id: string): Promise<void> {
  emit({ ...state, busyHostId: id, notice: null });
  try {
    const response = await fetch(`/api/agent/compute-hosts/${encodeURIComponent(id)}/wake`, {
      method: "POST",
    });
    const body = (await response.json()) as { message?: string; accepted?: boolean };
    emit({
      ...state,
      notice: {
        text: body.message ?? "The wake request finished.",
        tone: body.accepted ? "info" : "danger",
      },
    });
  } catch {
    emit({ ...state, notice: { text: "The wake request could not be sent.", tone: "danger" } });
  } finally {
    emit({ ...state, busyHostId: null });
    await refreshComputeHosts();
  }
}

export type ComputeHostPowerMode = "AI_AUTO" | "NORMAL_GAMING" | "KEEP_AWAKE" | "NORMAL";

/**
 * Hand the host's power behaviour back to its owner.
 *
 * `NORMAL` is the one that matters day to day and it is not a governor mode:
 * it is the combination that actually stops a machine putting itself to sleep
 * while someone is using it. The runtime performs all three steps, because any
 * one of them alone leaves the machine sleeping again.
 */
export async function setComputeHostPowerMode(
  id: string,
  mode: ComputeHostPowerMode,
): Promise<void> {
  emit({ ...state, busyHostId: id, notice: null });
  try {
    const response = await fetch(
      `/api/agent/compute-hosts/${encodeURIComponent(id)}/power-mode?mode=${mode}`,
      { method: "POST" },
    );
    const body = (await response.json()) as { detail?: string; ok?: boolean };
    emit({
      ...state,
      notice: {
        text: body.detail ?? "The power mode request finished.",
        tone: body.ok ? "info" : "danger",
      },
    });
  } catch {
    emit({
      ...state,
      notice: { text: "The power mode request could not be sent.", tone: "danger" },
    });
  } finally {
    emit({ ...state, busyHostId: null });
    await refreshComputeHosts();
  }
}
