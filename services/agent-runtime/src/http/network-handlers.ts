//
// The network surface the owner's UI reads and writes.
//
// Three routes and no more: what the state is, what the conversation wants, and
// importing a provider configuration. Nothing here returns key material, and
// the import route takes the configuration text once and never hands it back —
// `describeProvider()` is the only view of it that leaves this process.
//

import { parseNetworkPolicy } from "../../../../shared/agent/network-policy";
import { networkService } from "../network";
import { importWireGuardConfig, clearProfile, loadProfile, describeProvider } from "../network/provider";
import { resolveDataDir } from "../data-dir";

export function handleNetworkStatus(): Response {
  return Response.json({ ok: true, status: networkService().status() });
}

export async function handleNetworkPolicy(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    policy?: unknown;
  } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const policy = parseNetworkPolicy(body?.policy);
  if (!sessionId) return Response.json({ ok: false, error: "sessionId is required" }, { status: 400 });
  if (!policy) {
    return Response.json({ ok: false, error: "policy must be direct or vpn_protected" }, { status: 400 });
  }

  const service = networkService();
  if (policy === "vpn_protected" && !service.isConfigured()) {
    //
    // Refused rather than accepted-and-degraded. A toggle that turns on and
    // then sits in ERROR teaches the owner that the padlock is decorative.
    //
    return Response.json(
      { ok: false, error: "no VPN configuration has been imported", status: service.status() },
      { status: 409 },
    );
  }

  service.setSessionPolicy(sessionId, policy);
  return Response.json({ ok: true, status: service.status() });
}

export async function handleNetworkProvider(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const profile = loadProfile(resolveDataDir());
    return Response.json({ ok: true, provider: profile ? describeProvider(profile) : null });
  }

  if (request.method === "DELETE") {
    clearProfile(resolveDataDir());
    networkService().reloadProfile();
    return Response.json({ ok: true, provider: null });
  }

  const body = (await request.json().catch(() => null)) as {
    config?: unknown;
    name?: unknown;
  } | null;
  const config = typeof body?.config === "string" ? body.config : "";
  const name = typeof body?.name === "string" ? body.name : "";
  if (!config.trim()) {
    return Response.json({ ok: false, error: "config is required" }, { status: 400 });
  }

  try {
    const provider = importWireGuardConfig(resolveDataDir(), config, name);
    networkService().reloadProfile();
    return Response.json({ ok: true, provider });
  } catch (error) {
    //
    // The message is the validator's own — "AllowedIPs must include 0.0.0.0/0",
    // "PrivateKey is not a valid WireGuard key" — and every one of them is
    // written to describe the shape of the problem without echoing the input,
    // so a malformed key never round-trips back to the browser.
    //
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "the configuration is not valid" },
      { status: 400 },
    );
  }
}
