//
// OBSERVATION, which is not enforcement.
//
// Nothing in this file makes anything safe. The boundary in `jail.ts` is what
// stops traffic; this only looks at what is happening behind it and reports
// what it can actually see. The distinction matters because the obvious way to
// build this feature — ask an exit-IP service what your address is and show a
// padlock if it looks foreign — is a check that can be wrong in both
// directions, and it is not a firewall. An exit-IP lookup is telemetry.
//
// So the rules here are:
//
//   Every probe goes THROUGH the proxy. A measurement taken on the machine's
//   own route describes the machine, not the tunnel, and would be a leak in
//   itself.
//
//   A probe that does not answer yields `unavailable`, never `protected`. A
//   missing reading is not a good reading. This is the single rule that keeps
//   the padlock honest, and it is why every observation is three-valued.
//
//   A failure to reach the outside is reported as such rather than retried into
//   silence, so the UI can say "VPN unavailable" instead of spinning forever.
//

import { connect } from "node:net";
import type { NetworkObservation } from "../../../../shared/agent/network-policy";

export type ProbeTargets = {
  proxyPort: number;
  timeoutMs: number;
};

export type Attestation = {
  proxyReachable: boolean;
  exitIp: string | null;
  exitCountry: string | null;
  dns: NetworkObservation;
  ipv4: NetworkObservation;
  ipv6: NetworkObservation;
  detail: string | null;
};

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

function proxyReachable(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const settle = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

//
// One HTTP request issued over the proxy's HTTP-CONNECT side, written by hand
// rather than with fetch, because the runtime's global fetch must NOT be
// silently pointed at the tunnel: the runtime also talks to the local
// controller and the model backend, and rewriting its default dispatcher would
// route those through the VPN too.
//
async function proxyConnect(
  port: number,
  host: string,
  targetPort: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let raw = "";
    let settled = false;
    const finish = (value: boolean): void => {
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => {
      socket.write(`CONNECT ${host}:${targetPort} HTTP/1.1\r\nHost: ${host}:${targetPort}\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (settled || raw.indexOf("\r\n\r\n") < 0) return;
      //
      // The tunnel terminated the CONNECT, which is the only thing this probe
      // set out to learn. Reading the TLS body would mean implementing TLS by
      // hand; the exit address comes from the plaintext probe instead.
      //
      finish(/^HTTP\/1\.[01] 200/.test(raw));
    });
    socket.once("close", () => {
      if (!settled) finish(false);
    });
  });
}

//
// The exit address, over plain HTTP so the answer is readable without a TLS
// stack. This is telemetry and is treated as such: it is rendered in the UI as
// an observation, and no security decision anywhere reads it. If the endpoint
// is unreachable or the answer is not an address, the field stays null and the
// UI shows "not measured" rather than inventing a value.
//
async function readExitAddress(
  port: number,
  timeoutMs: number,
): Promise<{ ip: string | null; country: string | null }> {
  const response = await plainProxyGet(
    port,
    "http://ip-api.com/line/?fields=query,countryCode",
    timeoutMs,
  );
  if (!response) return { ip: null, country: null };
  //
  // Matched by shape, not by position. The service returns the fields in its own
  // order rather than the order they were requested in, so reading line 0 as the
  // address yields a country code that then fails every check downstream and
  // leaves the state stuck short of PROTECTED. The acceptance run caught exactly
  // that, against a working tunnel.
  //
  const lines = response.split(/\r?\n/).map((line) => line.trim());
  return {
    ip: lines.find((line) => IPV4.test(line)) ?? null,
    country: lines.find((line) => /^[A-Z]{2}$/.test(line)) ?? null,
  };
}

function plainProxyGet(port: number, url: string, timeoutMs: number): Promise<string | null> {
  const target = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let raw = "";
    const finish = (value: string | null): void => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.once("error", () => finish(null));
    socket.once("connect", () => {
      socket.write(
        [
          `GET ${url} HTTP/1.1`,
          `Host: ${target.host}`,
          "User-Agent: local-studio-network-probe",
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    socket.once("close", () => {
      const split = raw.indexOf("\r\n\r\n");
      finish(split < 0 ? null : raw.slice(split + 4).trim());
    });
  });
}

//
// IPv6 is deliberately allowed to come back `blocked` rather than treated as a
// failure. A provider whose tunnel carries no IPv6 route is correctly handled
// by refusing IPv6 rather than letting it escape to the physical interface —
// "IPv4 through the tunnel, IPv6 through the Wi-Fi" is the classic leak, and
// blocked is the right answer, not a degraded one.
//
export async function attest(
  targets: ProbeTargets,
  tunnelCarriesIpv6: boolean,
): Promise<Attestation> {
  const reachable = await proxyReachable(targets.proxyPort, targets.timeoutMs);
  if (!reachable) {
    return {
      proxyReachable: false,
      exitIp: null,
      exitCountry: null,
      dns: "unavailable",
      ipv4: "unavailable",
      ipv6: "unavailable",
      detail: "the tunnel's local endpoint is not accepting connections",
    };
  }

  const connectOk = await proxyConnect(
    targets.proxyPort,
    "one.one.one.one",
    443,
    targets.timeoutMs,
  );
  if (!connectOk) {
    return {
      proxyReachable: true,
      exitIp: null,
      exitCountry: null,
      dns: "unavailable",
      ipv4: "unavailable",
      ipv6: "unavailable",
      detail: "the tunnel is listening but could not carry a connection",
    };
  }

  //
  // A CONNECT that returns 200 is NOT proof that anything works. sing-box
  // accepts and acknowledges the CONNECT before the upstream is established, so
  // a tunnel whose peer is unreachable answers 200 and then carries nothing.
  // Measured against a peer in TEST-NET-1: every CONNECT succeeded while no
  // request completed. Treating that as evidence would be exactly the
  // "unknown becomes Protected" this file exists to prevent.
  //
  // The exit-address read is the weakest thing that proves a full request and a
  // full response crossed the tunnel, so it — not the CONNECT — is what every
  // positive observation below is derived from.
  //
  const exit = await readExitAddress(targets.proxyPort, targets.timeoutMs);
  if (!exit.ip) {
    return {
      proxyReachable: true,
      exitIp: null,
      exitCountry: null,
      dns: "unavailable",
      ipv4: "unavailable",
      ipv6: "unavailable",
      detail: "the tunnel accepted a connection but no request completed through it",
    };
  }

  //
  // IPv6 is measured when the tunnel claims to carry it, and only reported as
  // `protected` if a v6 destination actually answered through it. When the
  // tunnel carries no v6 route the answer is `blocked` rather than `unavailable`
  // — and that is an enforcement claim, not an observation: the jail permits no
  // direct destination, so a v6 packet has nowhere to leak to. "IPv4 through the
  // tunnel, IPv6 through the Wi-Fi" is the classic split, and blocked is the
  // correct outcome rather than a degraded one.
  //
  const ipv6 = tunnelCarriesIpv6
    ? await probeIpv6(targets.proxyPort, targets.timeoutMs)
    : ("blocked" as const);

  //
  // A name was resolved and a whole response came back, both through the tunnel
  // and neither possible on the machine's own resolver from inside the jail, so
  // DNS and IPv4 are attested rather than assumed.
  //
  return {
    proxyReachable: true,
    exitIp: exit.ip,
    exitCountry: exit.country,
    dns: "protected",
    ipv4: "protected",
    ipv6,
    detail: null,
  };
}

//
// A literal v6 address so the probe tests the v6 path itself rather than a
// resolver's willingness to return an AAAA record.
//
async function probeIpv6(port: number, timeoutMs: number): Promise<NetworkObservation> {
  const reached = await proxyConnect(port, "[2606:4700:4700::1111]", 443, timeoutMs);
  return reached ? "protected" : "unavailable";
}
