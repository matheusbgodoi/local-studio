//
// The client half of the network surface. Three calls: read what is true, ask
// for what this conversation wants, and import the provider configuration that
// makes protection possible at all.
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

const ProviderResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  provider: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      protocol: Schema.String,
      endpointHost: Schema.String,
      fullTunnel: Schema.Boolean,
      hasIpv6: Schema.Boolean,
    }),
  ),
});

const decodeProvider = Schema.decodeUnknownSync(ProviderResponseSchema);

export type ImportedProvider = typeof ProviderResponseSchema.Type.provider;

export type ProviderImportOutcome =
  | { accepted: true; provider: ImportedProvider }
  | { accepted: false; error: string };

//
// The configuration text is sent once and never read back — the runtime keeps
// the keys and returns only a description of them. A rejection carries the
// validator's own words ("AllowedIPs must include 0.0.0.0/0", "PrivateKey is
// not a valid WireGuard key") because those tell the owner what to fix.
//
export function importNetworkProvider(
  config: string,
  name: string,
): Effect.Effect<ProviderImportOutcome, Error> {
  return Effect.tryPromise({
    try: async (): Promise<ProviderImportOutcome> => {
      const response = await fetch("/api/agent/network/provider", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, name }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) {
        return {
          accepted: false,
          error:
            typeof payload?.error === "string"
              ? payload.error
              : `The configuration was refused (HTTP ${response.status})`,
        };
      }
      return { accepted: true, provider: decodeProvider(payload).provider };
    },
    catch: (error) =>
      error instanceof Error ? error : new Error("Failed to import the configuration"),
  });
}

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
