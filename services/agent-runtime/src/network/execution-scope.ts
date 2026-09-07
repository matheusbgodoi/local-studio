import { AsyncLocalStorage } from "node:async_hooks";
import type { NetworkPolicy } from "../../../../shared/agent/network-policy";

const scope = new AsyncLocalStorage<NetworkPolicy>();

export function executionNetworkPolicy(): NetworkPolicy | undefined {
  return scope.getStore();
}

export function withExecutionNetworkPolicy<T>(policy: NetworkPolicy, task: () => T): T {
  return scope.run(policy, task);
}
