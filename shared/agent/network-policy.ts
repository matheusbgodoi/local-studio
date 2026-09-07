//
// The network contract, defined once.
//
// Two things live here and they are deliberately not the same thing.
//
// A NETWORK POLICY is what the owner asked for. It belongs to a conversation,
// and a Run copies it at birth and keeps it until it ends. It has two values
// and no third: traffic either has to go through the protected tunnel or it
// does not.
//
// A PROTECTION STATE is what is actually true right now. It belongs to the
// machine, not to any one conversation, because the enforcement boundary is
// process-wide. It is not a boolean, because "the tunnel is up" and "nothing
// can get out around it" are separate claims and either can be false while the
// other is true.
//
// Nothing in this file describes anonymity. A tunnel moves where packets leave
// from. It does not touch cookies, logins, tokens, or any identifier the
// application layer carries, so no word here implies that it does.
//

import { Schema } from "effect";

export const NETWORK_POLICIES = ["direct", "vpn_protected"] as const;

export type NetworkPolicy = (typeof NETWORK_POLICIES)[number];

export const NetworkPolicySchema = Schema.Literals(NETWORK_POLICIES);

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = "direct";

//
// DIRECT        the owner did not ask for protection; the machine's own route
//               is used and nothing is enforced.
// STARTING      protection was asked for and the tunnel is being established.
//               Public egress is already blocked at this point — the jail is
//               built before the tunnel, never after.
// PROTECTED     enforcement is active AND the tunnel is healthy AND enough of
//               the claim has been measured to say so.
// DEGRADED      protection appears to be in place but a measurement is missing
//               or unstable. Egress is still confined; the claim is not fully
//               attested. This is what an unmeasured field resolves to — never
//               PROTECTED.
// BLOCKED       protection is required and the tunnel is not available. Public
//               egress for protected workloads is refused. This is the correct
//               state for a tunnel that just died, and it is not an error.
// ERROR         the configuration is invalid or a failure that will not clear
//               by itself. Public egress for protected workloads stays refused.
//
export const NETWORK_PROTECTION_STATES = [
  "DIRECT",
  "STARTING",
  "PROTECTED",
  "DEGRADED",
  "BLOCKED",
  "ERROR",
] as const;

export type NetworkProtectionState = (typeof NETWORK_PROTECTION_STATES)[number];

export const NetworkProtectionStateSchema = Schema.Literals(NETWORK_PROTECTION_STATES);

//
// Every observation is three-valued on purpose. "unavailable" means nobody
// measured it, and it must never be rendered as if it were "protected" — the
// whole point of the separate value is that absence of a reading is not
// evidence of a good one.
//
export const NETWORK_OBSERVATIONS = ["protected", "blocked", "unprotected", "unavailable"] as const;

export type NetworkObservation = (typeof NETWORK_OBSERVATIONS)[number];

export const NetworkObservationSchema = Schema.Literals(NETWORK_OBSERVATIONS);

const nullableString = Schema.NullOr(Schema.String);

//
// What the tunnel is, as measured. Every field is nullable because every field
// comes from a reading that may not have been taken. `provider` is whatever the
// imported configuration called itself; no provider name is assumed anywhere in
// this codebase.
//
export const NetworkTunnelSchema = Schema.Struct({
  connected: Schema.Boolean,
  provider: nullableString,
  protocol: nullableString,
  exitCountry: nullableString,
  exitIp: nullableString,
  endpointHost: nullableString,
  lastHandshakeMs: Schema.NullOr(Schema.Number),
});

export type NetworkTunnel = typeof NetworkTunnelSchema.Type;

//
// What the boundary is, as enforced. `failClosed` is the load-bearing claim:
// it says a protected workload has no permitted route to the public internet
// other than the tunnel. It is derived from the enforcement layer's own state,
// never from an exit-IP lookup.
//
export const NetworkEnforcementSchema = Schema.Struct({
  failClosed: Schema.Boolean,
  mechanism: nullableString,
  proxyEndpoint: nullableString,
  jailedProcesses: Schema.Number,
  unconfinedPaths: Schema.Array(Schema.String),
});

export type NetworkEnforcement = typeof NetworkEnforcementSchema.Type;

export const NetworkStatusSchema = Schema.Struct({
  state: NetworkProtectionStateSchema,
  policy: NetworkPolicySchema,
  tunnel: NetworkTunnelSchema,
  enforcement: NetworkEnforcementSchema,
  dns: NetworkObservationSchema,
  ipv4: NetworkObservationSchema,
  ipv6: NetworkObservationSchema,
  detail: nullableString,
  configured: Schema.Boolean,
  protectedSessionCount: Schema.Number,
  updatedAtMs: Schema.Number,
});

export type NetworkStatus = typeof NetworkStatusSchema.Type;

export function isProtectedPolicy(policy: NetworkPolicy | null | undefined): boolean {
  return policy === "vpn_protected";
}

export function parseNetworkPolicy(value: unknown): NetworkPolicy | null {
  return typeof value === "string" && NETWORK_POLICIES.includes(value as NetworkPolicy)
    ? (value as NetworkPolicy)
    : null;
}

//
// A protected workload may run only while the boundary is both enforced and
// attested. DEGRADED is deliberately permissive about *traffic* and honest
// about the *claim*: the jail is up, so nothing can leak, but the UI must not
// say PROTECTED. BLOCKED and ERROR refuse, and STARTING refuses because the
// tunnel behind the jail is not ready yet.
//
export function allowsProtectedEgress(state: NetworkProtectionState): boolean {
  return state === "PROTECTED" || state === "DEGRADED";
}

//
// The only states in which a protected workload is waiting on infrastructure
// rather than having failed at anything. A Run in one of these is paused, in
// exactly the sense a Run whose backend went away is paused.
//
export function isProtectionInterrupted(state: NetworkProtectionState): boolean {
  return state === "BLOCKED" || state === "ERROR" || state === "STARTING";
}
