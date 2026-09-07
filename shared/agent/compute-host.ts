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
  controlUrlFallback: string;
  controlToken: string;
  wakeUrl: string;
  wakeMac: string;
  wakeBroadcast: string;
  wakeEnabled: boolean;
  autoWake: boolean;
  readyTimeoutMs: number;
};

export const DEFAULT_WAKE_BROADCAST = "255.255.255.255";

//
// Two ways to wake the same machine, and the one that works from anywhere goes
// first.
//
// The HTTP bridge is a Pico W that lives on the target's LAN permanently and
// sends the packet on request, so it answers whether this Mac is home or not.
// A magic packet sent from here has to be born inside the target's own
// broadcast domain, so it only reaches the host while both are on the same
// network — but it needs no secret and no third device, which makes it the
// right fallback for the evening the internet is down and the power is not.
//
// Note what neither of them can be: Tailscale. The tailnet is software running
// on the target, and a powered-off machine runs nothing. Waking is the one
// operation that must happen outside it.
//
export function normalizeMacAddress(value: string): string | null {
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 12) return null;
  return hex;
}

export function magicPacket(mac: string): Uint8Array | null {
  const hex = normalizeMacAddress(mac);
  if (!hex) return null;
  const address = new Uint8Array(6);
  for (let i = 0; i < 6; i += 1) address[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const packet = new Uint8Array(102);
  packet.fill(0xff, 0, 6);
  for (let repeat = 0; repeat < 16; repeat += 1) packet.set(address, 6 + repeat * 6);
  return packet;
}

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
  wakeMethods: ComputeHostWakeMethod[];
  wakeEnabled: boolean;
  autoWake: boolean;
  wakeInFlight: boolean;
  wakeCooldownUntil: string | null;
  lastWakeAt: string | null;
  lastWakeOutcome: "ready" | "timeout" | "failed" | null;
};

export type ComputeHostWakeMethod = "lan-magic-packet" | "http-bridge";

export type ComputeHostWakeResult = {
  id: string;
  accepted: boolean;
  method: ComputeHostWakeMethod | null;
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
    controlUrlFallback: "",
    controlToken: "",
    wakeUrl: "",
    wakeMac: "",
    wakeBroadcast: DEFAULT_WAKE_BROADCAST,
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
