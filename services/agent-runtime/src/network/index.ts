//
// The one handle the rest of the runtime holds.
//
// The boundary has to be process-wide to mean anything — two NetworkService
// objects would be two opinions about whether the jail exists — so it is
// registered through the same global singleton registry every other long-lived
// runtime object uses.
//

import { getGlobalSingleton } from "../instances";
import { NetworkService } from "./service";

export { NetworkService } from "./service";
export type { NetworkEvent } from "./service";
export type { JailedCommand } from "./jail";

export function networkService(): NetworkService {
  return getGlobalSingleton("network-service", () => new NetworkService());
}

//
// The convenience the spawn sites actually use. Every place that starts a
// process on the agent's behalf calls this instead of building argv by hand, so
// adding a new spawn site without protecting it is a visible omission rather
// than a silent leak.
//
export function protectedSpawn(command: string, args: string[]): { command: string; args: string[] } {
  return networkService().wrap({ command, args });
}

export function protectedEnvironment(): Record<string, string> {
  return networkService().environment();
}

//
// For the in-process HTTP paths. `null` means Direct and the caller keeps its
// own transport; anything else dials the tunnel and nothing but the tunnel.
//
export function protectedHttpAgents(): ReturnType<NetworkService["httpAgents"]> {
  return networkService().httpAgents();
}

//
// For an in-process egress path that has NOT been taught to use the tunnel.
//
// Node's global fetch takes no agent, so a caller built on it cannot be routed
// without either a dependency this package does not declare or a global
// dispatcher that would drag model inference and controller traffic through the
// VPN as well. Until such a caller is converted, the honest behaviour is to
// refuse it while protection is demanded rather than let it out directly — a
// broken connector is recoverable, a silent leak is not.
//
export function assertRoutableEgress(what: string): void {
  const network = networkService();
  if (!network.protectionDemanded()) return;
  throw new Error(
    `${what} cannot be confined to the protected tunnel, so it was refused while VPN Protected is active`,
  );
}
