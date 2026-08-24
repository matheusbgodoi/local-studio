//
// The client half of the network surface. Two calls: read what is true, and ask
// for what this conversation wants.
//
// Every response is decoded through the shared schema rather than cast, because
// this is the one payload in the app whose fields are read as a safety claim: a
// field that did not arrive must land as `null`/"unavailable" and be rendered as
// unmeasured, never quietly defaulted into something reassuring.
//

import { Effect, Schema } from "effect";
import {
  NetworkStatusSchema,
  type NetworkPolicy,
  type NetworkStatus,
} from "@shared/agent/network-policy";

const NetworkStatusResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  status: NetworkStatusSchema,
});

const NetworkPolicyRefusalSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.String,
  status: Schema.optional(NetworkStatusSchema),
});

const decodeStatusResponse = Schema.decodeUnknownSync(NetworkStatusResponseSchema);
const decodeRefusal = Schema.decodeUnknownOption(NetworkPolicyRefusalSchema);

//
// A refusal is a first-class outcome, not an exception. The 409 "no VPN
// configuration has been imported" is the expected answer to asking for
// protection on a machine that has none, and the caller has to leave the
// control OFF and show the reason — so it is modelled, not thrown.
//
export type NetworkPolicyOutcome =
  | { accepted: true; status: NetworkStatus }
  | { accepted: false; error: string; status: NetworkStatus | null };

export function loadNetworkStatus(): Effect.Effect<NetworkStatus, Error> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch("/api/agent/network/status", { cache: "no-store" });
      if (!response.ok) throw new Error(`Network status failed with HTTP ${response.status}`);
      return decodeStatusResponse(await response.json()).status;
    },
    catch: (error) =>
      error instanceof Error ? error : new Error("Failed to read the network status"),
  });
}

export function requestNetworkPolicy(
  sessionId: string,
  policy: NetworkPolicy,
): Effect.Effect<NetworkPolicyOutcome, Error> {
  return Effect.tryPromise({
    try: async (): Promise<NetworkPolicyOutcome> => {
      const response = await fetch("/api/agent/network/policy", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, policy }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (response.ok) return { accepted: true, status: decodeStatusResponse(payload).status };
      const refusal = decodeRefusal(payload);
      if (refusal._tag === "None") {
        return {
          accepted: false,
          error: `The network policy was refused (HTTP ${response.status})`,
          status: null,
        };
      }
      return {
        accepted: false,
        error: refusal.value.error,
        status: refusal.value.status ?? null,
      };
    },
    catch: (error) =>
      error instanceof Error ? error : new Error("Failed to set the network policy"),
  });
}
