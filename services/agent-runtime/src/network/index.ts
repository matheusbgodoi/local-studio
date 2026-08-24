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
