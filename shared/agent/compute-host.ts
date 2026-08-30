export const COMPUTE_HOST_POWER_STATES = [
  "model-resident",
  "gateway-idle",
  "gaming",
  "unreachable",
  "waking",
  "unknown",
] as const;

export type ComputeHostPowerState = (typeof COMPUTE_HOST_POWER_STATES)[number];

export const DEFAULT_WAKE_READY_TIMEOUT_MS = 180_000;

export const WAKE_COOLDOWN_MS = 90_000;

export type ComputeHostConfig = {
  id: string;
  name: string;
  controlUrl: string;
  controlToken: string;
  wakeUrl: string;
  wakeEnabled: boolean;
  autoWake: boolean;
  readyTimeoutMs: number;
};

export type ComputeHostStatus = {
  id: string;
  name: string;
  state: ComputeHostPowerState;
  detail: string | null;
  gpuUsedMb: number | null;
  gpuTotalMb: number | null;
  residentModel: string | null;
  gatewayUp: boolean | null;
  lastSeenAt: string | null;
  checkedAt: string;
  wakeConfigured: boolean;
  wakeEnabled: boolean;
  autoWake: boolean;
  wakeInFlight: boolean;
  wakeCooldownUntil: string | null;
  lastWakeAt: string | null;
  lastWakeOutcome: "ready" | "timeout" | "failed" | null;
};

export type ComputeHostWakeResult = {
  id: string;
  accepted: boolean;
  reason:
    | "sent"
    | "already-online"
    | "in-flight"
    | "cooling-down"
    | "not-configured"
    | "disabled"
    | "failed";
  state: ComputeHostPowerState;
  message: string;
};

export function defaultComputeHostConfig(overrides: Partial<ComputeHostConfig> = {}) {
  return {
    id: "rtx3090",
    name: "RTX 3090",
    controlUrl: "",
    controlToken: "",
    wakeUrl: "",
    wakeEnabled: false,
    autoWake: false,
    readyTimeoutMs: DEFAULT_WAKE_READY_TIMEOUT_MS,
    ...overrides,
  } satisfies ComputeHostConfig;
}

export function isComputeHostOnline(state: ComputeHostPowerState): boolean {
  return state === "model-resident" || state === "gateway-idle" || state === "gaming";
}

export function redactWakeUrl(wakeUrl: string): string {
  if (!wakeUrl.trim()) return "";
  try {
    const url = new URL(wakeUrl);
    const params = [...url.searchParams.keys()];
    for (const key of params) url.searchParams.set(key, "…");
    return `${url.origin}${url.pathname}${params.length > 0 ? url.search : ""}`;
  } catch {
    return "(configured)";
  }
}
