//
// The tunnel process.
//
// sing-box is the transport: it holds the WireGuard endpoint and offers one
// loopback `mixed` inbound (SOCKS5 and HTTP CONNECT on the same port) which is
// the single destination the egress jail permits. It is NOT the boundary — a
// process that ignores the proxy does not leak past sing-box, it is refused by
// the kernel before it gets that far. sing-box's job is to be the one way
// out, not to stop the other ways.
//
// Three details in the generated configuration are load-bearing:
//
//   There is no direct outbound a public destination can reach. The only
//   `direct` outbound is selected by a rule that matches private CIDRs and
//   nothing else, and route.final is the tunnel — so a destination that is not
//   private has exactly one way out. sing-box failing to reach the peer surfaces
//   as a failed connection rather than as a direct one.
//
//   auto_detect_interface is false. With it true, sing-box binds direct dials
//   to the physical interface, and a connection to a Tailscale peer in
//   100.64.0.0/10 times out rather than failing loudly. The owner's model
//   backend may live on Tailscale, so this default would break the product in a
//   way that looks like the model being down.
//
//   DNS resolves through the tunnel and nowhere else. There is no local
//   fallback server, because a fallback is a leak: a name looked up on the
//   ISP's resolver has already told them where the traffic is going.
//

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { WireGuardProfile } from "./provider";

export type SingBoxOptions = {
  profile: WireGuardProfile;
  proxyPort: number;
  clashPort: number;
  runtimeDirectory: string;
};

//
// Everything that must keep working while protection is on and must therefore
// never be sent through the tunnel: loopback, link-local, and the RFC 6598
// range Tailscale uses. These are the ONLY exceptions, they are all private,
// and none of them is a route to the public internet.
//
const PRIVATE_DESTINATIONS = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

export function resolveSingBoxBinary(): string | null {
  const configured = process.env.LOCAL_STUDIO_SING_BOX_PATH?.trim();
  const candidates = [
    ...(configured ? [configured] : []),
    path.join(homedir(), ".local", "bin", "sing-box"),
    "/opt/homebrew/bin/sing-box",
    "/usr/local/bin/sing-box",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function buildConfig(options: SingBoxOptions): unknown {
  const { profile } = options;
  const tunnelDns = profile.dns.length > 0 ? profile.dns : ["1.1.1.1"];

  return {
    log: { level: "warn", timestamp: false },
    dns: {
      servers: tunnelDns.map((server, index) => ({
        type: "udp",
        tag: `tunnel-dns-${index}`,
        server,
        detour: "tunnel",
      })),
      final: "tunnel-dns-0",
      strategy: profile.allowedIps.includes("::/0") ? "prefer_ipv4" : "ipv4_only",
      independent_cache: true,
    },
    inbounds: [
      {
        type: "mixed",
        tag: "egress-in",
        listen: "127.0.0.1",
        listen_port: options.proxyPort,
      },
    ],
    endpoints: [
      {
        type: "wireguard",
        tag: "tunnel",
        system: false,
        ...(profile.mtu ? { mtu: profile.mtu } : {}),
        address: profile.addresses,
        private_key: profile.privateKey,
        peers: [
          {
            address: profile.endpointHost,
            port: profile.endpointPort,
            public_key: profile.peerPublicKey,
            ...(profile.peerPresharedKey ? { pre_shared_key: profile.peerPresharedKey } : {}),
            allowed_ips: profile.allowedIps,
          },
        ],
      },
    ],
    outbounds: [{ type: "direct", tag: "private-direct" }],
    route: {
      auto_detect_interface: false,
      rules: [
        { ip_cidr: PRIVATE_DESTINATIONS, outbound: "private-direct" },
        { action: "sniff" },
      ],
      final: "tunnel",
      default_domain_resolver: { server: "tunnel-dns-0" },
    },
    experimental: {
      clash_api: { external_controller: `127.0.0.1:${options.clashPort}` },
      cache_file: { enabled: false },
    },
  };
}

//
// The configuration carries the private key, so it is written 0600 into the
// 0700 runtime directory and never passed on the command line, where it would
// be readable in the process table by every process on the machine.
//
export function writeConfig(options: SingBoxOptions): string {
  mkdirSync(options.runtimeDirectory, { recursive: true, mode: 0o700 });
  const filepath = path.join(options.runtimeDirectory, "sing-box.json");
  writeFileSync(filepath, JSON.stringify(buildConfig(options), null, 2), { mode: 0o600 });
  return filepath;
}

export type TunnelProcess = {
  child: ChildProcess;
  configPath: string;
  lastError: () => string | null;
  stop: () => Promise<void>;
};

//
// sing-box writes key-decode failures to stderr by echoing the offending
// input. The profile validates key shape before we ever get here, but the log
// is still treated as untrusted: only the last line is retained, and anything
// that looks like base64 key material is redacted before it can become a
// status detail the owner or the model sees.
//
function redact(line: string): string {
  return line.replace(/[A-Za-z0-9+/]{42,}={0,2}/g, "[redacted]");
}

export function startTunnel(binary: string, options: SingBoxOptions): TunnelProcess {
  const configPath = writeConfig(options);
  const child = spawn(binary, ["run", "-c", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let lastError: string | null = null;
  const capture = (chunk: Buffer | string): void => {
    const text = String(chunk).trim();
    if (!text) return;
    const line = redact(text.split(/\r?\n/).at(-1) ?? "");
    if (/error|fatal|failed/i.test(line)) lastError = line;
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (child.pid) process.kill(child.pid, "SIGKILL");
        } catch {
          // already gone
        }
        resolve();
      }, 4_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  return { child, configPath, lastError: () => lastError, stop };
}
