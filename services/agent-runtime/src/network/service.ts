//
// The network service: who is asking for protection, whether it is actually in
// place, and what a spawned process has to be wrapped in.
//
// ONE BOUNDARY, NOT ONE PER SESSION. The agent-runtime is a single Node process
// shared by every conversation — sessions are objects in a Map, subagents are
// more objects in the same Map, and the browser host, Playwright manager and
// connector pool are process-global singletons. There is therefore no honest
// way to give conversation A a different route from conversation B, and
// pretending otherwise would be the most dangerous kind of wrong: a padlock
// that means nothing.
//
// So the policy is stated plainly and enforced conservatively: PROTECTED WINS.
// While any session or any live Run asks for protection, the boundary is up and
// every agent-spawned process goes through the tunnel — including those
// belonging to conversations set to Direct. That is a real cost and the UI says
// so out loud. The alternative, letting a protected workload occasionally take
// the direct route, is the one outcome this feature exists to prevent.
//
// ENFORCEMENT AND ATTESTATION ARE SEPARATE. `enforced` is true when the jail
// exists and the tunnel process is running — it is what makes traffic safe.
// `attestation` is what a probe could observe. A state of PROTECTED needs both;
// DEGRADED is what a working boundary with an incomplete measurement is called,
// and it is never rendered as PROTECTED.
//

import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  allowsProtectedEgress,
  type NetworkPolicy,
  type NetworkProtectionState,
  type NetworkStatus,
} from "../../../../shared/agent/network-policy";
import { resolveDataDir } from "../data-dir";
import { attest, type Attestation } from "./attestation";
import {
  chromiumJailArguments,
  JAIL_MECHANISM,
  jailCommand,
  jailEnvironment,
  jailSupported,
  unconfinedPaths,
  writeProfile,
  type JailedCommand,
} from "./jail";
import { describeProvider, loadProfile, type WireGuardProfile } from "./provider";
import { resolveSingBoxBinary, startTunnel, type TunnelProcess } from "./sing-box";

const PROXY_PORT = Number(process.env.LOCAL_STUDIO_EGRESS_PROXY_PORT ?? 47_318);
const CLASH_PORT = Number(process.env.LOCAL_STUDIO_EGRESS_CLASH_PORT ?? 47_319);
const ATTEST_INTERVAL_MS = 15_000;
const ATTEST_TIMEOUT_MS = 6_000;
const START_GRACE_MS = 20_000;

export type NetworkEvent =
  | "network.policy.changed"
  | "vpn.starting"
  | "vpn.protected"
  | "vpn.degraded"
  | "vpn.blocked"
  | "vpn.disconnected"
  | "vpn.reconnected"
  | "vpn.health.failed";

type Listener = (event: NetworkEvent, detail: string | null) => void;

export class NetworkService {
  private readonly sessionPolicies = new Map<string, NetworkPolicy>();
  private readonly runPolicies = new Map<string, NetworkPolicy>();
  private readonly listeners = new Set<Listener>();

  private profile: WireGuardProfile | null = null;
  private tunnel: TunnelProcess | null = null;
  private profilePath: string | null = null;
  private attestation: Attestation | null = null;
  private state: NetworkProtectionState = "DIRECT";
  private detail: string | null = null;
  private startedAtMs = 0;
  private timer: NodeJS.Timeout | null = null;
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string = resolveDataDir()) {
    this.profile = loadProfile(this.dataDir);
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: NetworkEvent, detail: string | null = null): void {
    for (const listener of this.listeners) {
      try {
        listener(event, detail);
      } catch {
        // a listener must not be able to break the boundary it is watching
      }
    }
  }

  reloadProfile(): void {
    this.profile = loadProfile(this.dataDir);
  }

  isConfigured(): boolean {
    return this.profile !== null && resolveSingBoxBinary() !== null;
  }

  //
  // The demand side. A session's preference and a Run's captured policy are
  // held separately because they have different lifetimes: a conversation can
  // be flipped to Direct at any moment, while a Run keeps the policy it was
  // born with until it ends. Either one asking is enough.
  //
  setSessionPolicy(sessionId: string, policy: NetworkPolicy): void {
    const previous = this.sessionPolicies.get(sessionId);
    if (previous === policy) return;
    if (policy === "direct") this.sessionPolicies.delete(sessionId);
    else this.sessionPolicies.set(sessionId, policy);
    this.emit("network.policy.changed", `session ${sessionId} → ${policy}`);
    void this.reconcile();
  }

  releaseSession(sessionId: string): void {
    if (this.sessionPolicies.delete(sessionId)) void this.reconcile();
  }

  setRunPolicy(runId: string, policy: NetworkPolicy): void {
    if (policy === "direct") this.runPolicies.delete(runId);
    else this.runPolicies.set(runId, policy);
    void this.reconcile();
  }

  releaseRun(runId: string): void {
    if (this.runPolicies.delete(runId)) void this.reconcile();
  }

  protectionDemanded(): boolean {
    return this.sessionPolicies.size > 0 || this.runPolicies.size > 0;
  }

  protectedSessionCount(): number {
    return this.sessionPolicies.size + this.runPolicies.size;
  }

  currentState(): NetworkProtectionState {
    return this.state;
  }

  //
  // Whether a protected workload may talk to the outside right now. The
  // scheduler asks this before an external operation, and a `false` answer
  // pauses the Run rather than failing it — the same way a lost backend does.
  //
  mayEgress(): boolean {
    if (!this.protectionDemanded()) return true;
    return allowsProtectedEgress(this.state);
  }

  //
  // What every spawn site calls. When protection is not demanded this returns
  // the command untouched, which is what keeps Direct mode exactly as fast and
  // as capable as it was before this feature existed.
  //
  wrap(command: JailedCommand): JailedCommand {
    if (!this.protectionDemanded() || !this.profilePath) return command;
    return jailCommand(this.profilePath, command);
  }

  environment(): Record<string, string> {
    return this.protectionDemanded() ? jailEnvironment(PROXY_PORT) : {};
  }

  chromiumArguments(): string[] {
    return this.protectionDemanded() && this.profilePath ? chromiumJailArguments(PROXY_PORT) : [];
  }

  proxyEndpoint(): string | null {
    return this.protectionDemanded() ? `127.0.0.1:${PROXY_PORT}` : null;
  }

  //
  // Transitions are serialised through one promise chain. Two conversations
  // flipping their toggle at the same moment must not be able to start two
  // tunnels or tear one down while the other is building it.
  //
  private reconcile(): Promise<void> {
    this.transition = this.transition.then(() => this.applyDemand()).catch(() => undefined);
    return this.transition;
  }

  private async applyDemand(): Promise<void> {
    if (this.protectionDemanded()) await this.engage();
    else await this.disengage();
  }

  //
  // ORDER MATTERS AND IT IS THE SECURITY PROPERTY. The jail profile is written
  // and the state leaves DIRECT before the tunnel is asked to start. For the
  // whole window in which the tunnel is coming up, protected work is refused
  // rather than allowed out directly — a boundary built after the traffic
  // starts is not a boundary.
  //
  private async engage(): Promise<void> {
    if (this.tunnel) return;

    if (!jailSupported()) {
      this.fail("this platform has no supported egress boundary; protection cannot be enforced");
      return;
    }
    this.reloadProfile();
    const binary = resolveSingBoxBinary();
    if (!this.profile || !binary) {
      this.fail(
        !this.profile
          ? "no VPN configuration has been imported"
          : "sing-box was not found; install it or set LOCAL_STUDIO_SING_BOX_PATH",
      );
      return;
    }

    const runtimeDirectory = path.join(this.dataDir, "network");
    mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });

    this.profilePath = writeProfile({
      proxyPort: PROXY_PORT,
      profileDirectory: runtimeDirectory,
      writableRoots: [this.dataDir, process.env.LOCAL_STUDIO_AGENT_CWD ?? ""],
    });

    this.state = "STARTING";
    this.detail = null;
    this.startedAtMs = Date.now();
    this.emit("vpn.starting");

    try {
      this.tunnel = startTunnel(binary, {
        profile: this.profile,
        proxyPort: PROXY_PORT,
        clashPort: CLASH_PORT,
        runtimeDirectory,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "the tunnel process could not be started");
      return;
    }

    this.tunnel.child.once("exit", () => {
      //
      // The tunnel died. The jail stays exactly where it is, so nothing escapes
      // while this is true; the state simply becomes the honest one. This is
      // BLOCKED rather than ERROR because a tunnel that dropped may well come
      // back, and a Run waiting on it has not failed at anything.
      //
      this.tunnel = null;
      if (!this.protectionDemanded()) return;
      this.state = "BLOCKED";
      this.detail = "the tunnel process is not running; public egress is blocked";
      this.emit("vpn.disconnected", this.detail);
      void this.reconcile();
    });

    this.startAttesting();
  }

  private async disengage(): Promise<void> {
    this.stopAttesting();
    const tunnel = this.tunnel;
    this.tunnel = null;
    this.profilePath = null;
    this.attestation = null;
    this.state = "DIRECT";
    this.detail = null;
    if (tunnel) {
      await tunnel.stop();
      this.emit("vpn.disconnected", "protection is no longer requested");
    }
  }

  private fail(detail: string): void {
    this.state = "ERROR";
    this.detail = detail;
    this.profilePath = null;
    this.emit("vpn.blocked", detail);
  }

  private startAttesting(): void {
    this.stopAttesting();
    const tick = (): void => {
      void this.measure();
    };
    this.timer = setInterval(tick, ATTEST_INTERVAL_MS);
    this.timer.unref?.();
    tick();
  }

  private stopAttesting(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async measure(): Promise<void> {
    if (!this.protectionDemanded() || !this.tunnel) return;
    const carriesIpv6 = this.profile?.allowedIps.includes("::/0") ?? false;
    const reading = await attest(
      { proxyPort: PROXY_PORT, timeoutMs: ATTEST_TIMEOUT_MS },
      carriesIpv6,
    );
    this.attestation = reading;
    const previous = this.state;

    if (!reading.proxyReachable || reading.ipv4 === "unavailable") {
      //
      // A tunnel that has not finished coming up is STARTING, not BLOCKED. Past
      // the grace window the same reading means it is not going to, and the
      // owner is told rather than shown a spinner that never resolves.
      //
      const starting = Date.now() - this.startedAtMs < START_GRACE_MS;
      this.state = starting ? "STARTING" : "BLOCKED";
      this.detail = reading.detail;
      if (!starting && previous !== "BLOCKED") this.emit("vpn.health.failed", reading.detail);
      return;
    }

    //
    // The boundary is up and traffic is flowing. PROTECTED requires the exit
    // address to have been read as well: without it the claim on the popover
    // would be a padlock next to a row of blanks, and DEGRADED says exactly
    // that — confined, but not fully measured.
    //
    this.state = reading.exitIp ? "PROTECTED" : "DEGRADED";
    this.detail = reading.exitIp ? null : "the exit address could not be measured";
    if (this.state === "PROTECTED" && previous !== "PROTECTED") {
      this.emit(previous === "BLOCKED" ? "vpn.reconnected" : "vpn.protected");
    }
    if (this.state === "DEGRADED" && previous !== "DEGRADED") this.emit("vpn.degraded", this.detail);
  }

  status(): NetworkStatus {
    const provider = this.profile ? describeProvider(this.profile) : null;
    const enforced = this.protectionDemanded() && this.profilePath !== null;
    const reading = this.attestation;

    return {
      state: this.state,
      policy: this.protectionDemanded() ? "vpn_protected" : "direct",
      tunnel: {
        connected: this.tunnel !== null && this.state !== "BLOCKED",
        provider: provider?.name ?? null,
        protocol: provider ? provider.protocol : null,
        exitCountry: reading?.exitCountry ?? null,
        exitIp: reading?.exitIp ?? null,
        endpointHost: provider?.endpointHost ?? null,
        lastHandshakeMs: null,
      },
      enforcement: {
        //
        // The load-bearing claim, and it is deliberately not derived from any
        // probe: the jail either exists or it does not, and while it exists a
        // protected workload has no permitted route to the public internet
        // other than the tunnel.
        //
        failClosed: enforced,
        mechanism: enforced ? JAIL_MECHANISM : null,
        proxyEndpoint: this.proxyEndpoint(),
        jailedProcesses: 0,
        unconfinedPaths: enforced ? unconfinedPaths(false) : [],
      },
      dns: reading?.dns ?? "unavailable",
      ipv4: reading?.ipv4 ?? "unavailable",
      ipv6: reading?.ipv6 ?? "unavailable",
      detail: this.detail,
      configured: this.isConfigured(),
      protectedSessionCount: this.protectedSessionCount(),
      updatedAtMs: Date.now(),
    };
  }

  async shutdown(): Promise<void> {
    this.sessionPolicies.clear();
    this.runPolicies.clear();
    await this.reconcile();
  }
}
