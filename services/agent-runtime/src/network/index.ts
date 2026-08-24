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
// The fetch an in-process caller acting for the agent must use.
//
// Three answers, and none of them is "go direct while protected":
//
//   Direct                      -> the global fetch, untouched.
//   Protected, routable         -> a fetch whose only socket factory is the
//                                  CONNECT tunnel.
//   Protected, not routable     -> throws. Under Bun an Agent's createConnection
//                                  override is ignored, so a "routed" request
//                                  would silently go direct; refusing is the
//                                  only honest answer there.
//
export function protectedFetch(what: string): typeof fetch {
  const network = networkService();
  if (!network.protectionDemanded()) return fetch;
  const routed = network.httpFetch();
  if (routed) return routed;
  throw new Error(
    `${what} cannot be confined to the protected tunnel on this runtime, so it was refused while VPN Protected is active`,
  );
}
