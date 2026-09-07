import { getGlobalSingleton } from "../instances";
import { NetworkService } from "./service";
import { executionNetworkPolicy } from "./execution-scope";

export { NetworkService } from "./service";
export type { NetworkEvent } from "./service";
export type { JailedCommand } from "./jail";

export function networkService(): NetworkService {
  return getGlobalSingleton("network-service", () => new NetworkService());
}

export function protectedSpawn(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return networkService().wrap({ command, args }, executionNetworkPolicy());
}

export function protectedEnvironment(): Record<string, string> {
  return networkService().environment(executionNetworkPolicy());
}

export function protectedHttpAgents(): ReturnType<NetworkService["httpAgents"]> {
  return networkService().httpAgents(executionNetworkPolicy());
}

export function protectedFetch(what: string): typeof fetch {
  const network = networkService();
  const policy = executionNetworkPolicy();
  if (policy ? policy === "direct" : !network.protectionDemanded()) return fetch;
  const routed = network.httpFetch(policy);
  if (routed) return routed;
  throw new Error(
    `${what} cannot be confined to the protected tunnel on this runtime, so it was refused while VPN Protected is active`,
  );
}
