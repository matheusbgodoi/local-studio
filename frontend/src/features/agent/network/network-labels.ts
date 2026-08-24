//
// How the network state is allowed to be worded, in one place.
//
// TWO RULES GOVERN EVERY STRING HERE.
//
// 1. An absent reading is said to be absent. `null` and "unavailable" mean
//    nobody measured the thing, and they render as "not measured" — never as a
//    dash the reader fills in optimistically, and never as a positive value.
// 2. Nothing claims anonymity. A tunnel changes where packets leave from; it
//    does not touch cookies, logins, tokens, or anything the application layer
//    carries. No word here implies otherwise.
//

import type { NetworkObservation, NetworkProtectionState } from "@shared/agent/network-policy";

export const NOT_MEASURED = "not measured";

/** Short label for the Status row. */
const STATE_LABELS: Record<NetworkProtectionState, string> = {
  DIRECT: "Direct",
  STARTING: "Starting",
  PROTECTED: "Protected",
  DEGRADED: "Degraded",
  BLOCKED: "Blocked",
  ERROR: "Error",
};

/** The one-line sentence the popover leads with. */
const STATE_HEADLINES: Record<NetworkProtectionState, string> = {
  DIRECT: "Direct — no protection requested",
  STARTING: "Starting — egress is already confined, the tunnel is coming up",
  PROTECTED: "Protected — egress is confined to the tunnel",
  DEGRADED: "Degraded — egress is confined, the claim is not fully measured",
  BLOCKED: "VPN unavailable — protected network blocked",
  ERROR: "VPN unavailable — protected network blocked",
};

export type NetworkTone = "ok" | "warn" | "danger" | "quiet";

const STATE_TONES: Record<NetworkProtectionState, NetworkTone> = {
  DIRECT: "quiet",
  STARTING: "warn",
  PROTECTED: "ok",
  DEGRADED: "warn",
  BLOCKED: "danger",
  ERROR: "danger",
};

const TONE_DOT_CLASSES: Record<NetworkTone, string> = {
  ok: "bg-(--ok)",
  warn: "bg-(--warn)",
  danger: "bg-(--err)",
  quiet: "bg-(--hl2)",
};

export function networkStateLabel(state: NetworkProtectionState): string {
  return STATE_LABELS[state];
}

export function networkStateHeadline(state: NetworkProtectionState): string {
  return STATE_HEADLINES[state];
}

export function networkStateTone(state: NetworkProtectionState): NetworkTone {
  return STATE_TONES[state];
}

export function networkToneDotClass(tone: NetworkTone): string {
  return TONE_DOT_CLASSES[tone];
}

/** BLOCKED and ERROR are the two states in which a protected workload has no
 *  route out. Neither is a failure of the work itself. */
export function isNetworkUnavailable(state: NetworkProtectionState): boolean {
  return state === "BLOCKED" || state === "ERROR";
}

const OBSERVATION_LABELS: Record<NetworkObservation, string> = {
  protected: "Protected",
  blocked: "Blocked",
  unprotected: "Unprotected",
  unavailable: NOT_MEASURED,
};

export function observationLabel(observation: NetworkObservation): string {
  return OBSERVATION_LABELS[observation];
}

/** Any nullable measurement — a provider name, an exit country, an IP. */
export function measuredLabel(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || NOT_MEASURED;
}

/** `connected` is a boolean the runtime always sets, so it is stated plainly —
 *  but "Up" is never inferred from any of the nullable fields around it. */
export function tunnelLabel(connected: boolean): string {
  return connected ? "Up" : "Down";
}

export function failClosedLabel(failClosed: boolean): string {
  return failClosed ? "Enforced" : "Not enforced";
}
