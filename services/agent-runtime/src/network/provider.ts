//
// The VPN provider, as configuration rather than as an integration.
//
// Local Studio does not speak any provider's private API. It reads a WireGuard
// configuration file — the artefact Proton, Mullvad, IVPN and every other
// provider hands out from their own dashboard — and turns it into a sing-box
// endpoint. That is deliberate: a provider's internal login and server-list
// endpoints are undocumented, unversioned and change without notice, and
// building the security boundary on top of one would mean the boundary breaks
// when they ship. A .conf file is a stable, supported, documented artefact.
//
// The cost is one manual step: the owner downloads a config and imports it. The
// benefit is that this works with any WireGuard provider and cannot be broken
// by a vendor's API change.
//
// SECRETS. The private key and any preshared key are read from the imported
// file, written to a 0600 file inside the 0700 data directory, and never leave
// this process: they are not in the status contract, not sent to the frontend,
// not put in the model's context, not logged, and not written into any error
// message. `describeProvider()` is what the rest of the runtime is allowed to
// see, and it carries no key material.
//

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type WireGuardProfile = {
  name: string;
  privateKey: string;
  addresses: string[];
  dns: string[];
  peerPublicKey: string;
  peerPresharedKey: string | null;
  endpointHost: string;
  endpointPort: number;
  allowedIps: string[];
  mtu: number | null;
};

//
// What anyone outside this module may know about the configured provider.
// Every field here is safe to render, log and ship to the frontend.
//
export type ProviderDescription = {
  name: string;
  protocol: "WireGuard";
  endpointHost: string;
  endpointPort: number;
  fullTunnel: boolean;
  hasIpv6: boolean;
  dnsCount: number;
};

const PROFILE_FILENAME = "vpn-profile.json";
const KEY_PATTERN = /^[A-Za-z0-9+/]{42}[A-Za-z0-9+/=]{2}$/;

function parseIniLike(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const heading = /^\[(.+)]$/.exec(line);
    if (heading?.[1]) {
      current = heading[1].trim().toLowerCase();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0 || !current) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    sections.get(current)?.set(key, value);
  }
  return sections;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

//
// A malformed key must be rejected here rather than by sing-box at start time,
// because sing-box reports it by echoing the offending bytes into its log — and
// that log is read by the supervisor and surfaced as a status detail. Validating
// the shape first means key material never reaches a string anyone will see.
//
function requireKey(value: string | undefined, field: string): string {
  const key = (value ?? "").trim();
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`${field} is not a valid WireGuard key`);
  }
  return key;
}

export function parseWireGuardConfig(text: string, fallbackName: string): WireGuardProfile {
  const sections = parseIniLike(text);
  const iface = sections.get("interface");
  const peer = sections.get("peer");
  if (!iface || !peer) {
    throw new Error("WireGuard configuration needs both an [Interface] and a [Peer] section");
  }

  const endpoint = (peer.get("endpoint") ?? "").trim();
  const lastColon = endpoint.lastIndexOf(":");
  if (lastColon <= 0) {
    throw new Error("WireGuard [Peer] needs an Endpoint of the form host:port");
  }
  const endpointHost = endpoint.slice(0, lastColon).replace(/^\[|]$/g, "");
  const endpointPort = Number(endpoint.slice(lastColon + 1));
  if (!Number.isInteger(endpointPort) || endpointPort <= 0 || endpointPort > 65535) {
    throw new Error("WireGuard [Peer] Endpoint port is not a port number");
  }

  const addresses = splitList(iface.get("address"));
  if (addresses.length === 0) {
    throw new Error("WireGuard [Interface] needs an Address");
  }

  const mtuValue = Number(iface.get("mtu"));
  const preshared = peer.get("presharedkey")?.trim();

  return {
    name: fallbackName,
    privateKey: requireKey(iface.get("privatekey"), "[Interface] PrivateKey"),
    addresses,
    dns: splitList(iface.get("dns")),
    peerPublicKey: requireKey(peer.get("publickey"), "[Peer] PublicKey"),
    peerPresharedKey: preshared ? requireKey(preshared, "[Peer] PresharedKey") : null,
    endpointHost,
    endpointPort,
    allowedIps: splitList(peer.get("allowedips")),
    mtu: Number.isInteger(mtuValue) && mtuValue > 0 ? mtuValue : null,
  };
}

//
// A tunnel that does not carry every destination is not a tunnel, it is a
// split route — and a split route is exactly the silent direct-fallback path
// this whole feature exists to remove. AllowedIPs that omit a default route is
// therefore refused at import rather than accepted and quietly leaked through.
//
export function assertFullTunnel(profile: WireGuardProfile): void {
  const hasV4 = profile.allowedIps.some((entry) => entry === "0.0.0.0/0");
  if (!hasV4) {
    throw new Error(
      "WireGuard [Peer] AllowedIPs must include 0.0.0.0/0; a split tunnel would leave a direct path for some destinations",
    );
  }
}

export function describeProvider(profile: WireGuardProfile): ProviderDescription {
  return {
    name: profile.name,
    protocol: "WireGuard",
    endpointHost: profile.endpointHost,
    endpointPort: profile.endpointPort,
    fullTunnel: profile.allowedIps.includes("0.0.0.0/0"),
    hasIpv6: profile.allowedIps.includes("::/0"),
    dnsCount: profile.dns.length,
  };
}

function profilePath(dataDir: string): string {
  return path.join(dataDir, PROFILE_FILENAME);
}

export function storeProfile(dataDir: string, profile: WireGuardProfile): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filepath = profilePath(dataDir);
  writeFileSync(filepath, JSON.stringify(profile), { mode: 0o600 });
  try {
    chmodSync(filepath, 0o600);
  } catch {
    // best-effort; the write already requested the mode
  }
}

export function loadProfile(dataDir: string): WireGuardProfile | null {
  const filepath = profilePath(dataDir);
  if (!existsSync(filepath)) return null;
  try {
    return JSON.parse(readFileSync(filepath, "utf8")) as WireGuardProfile;
  } catch {
    return null;
  }
}

export function clearProfile(dataDir: string): void {
  rmSync(profilePath(dataDir), { force: true });
}

export function importWireGuardConfig(
  dataDir: string,
  text: string,
  name: string,
): ProviderDescription {
  const profile = parseWireGuardConfig(text, name.trim() || "WireGuard");
  assertFullTunnel(profile);
  storeProfile(dataDir, profile);
  return describeProvider(profile);
}
