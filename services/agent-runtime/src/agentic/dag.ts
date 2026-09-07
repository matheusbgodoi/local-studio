//
// Task DAG semantics.
//
// READY is derived, never stored as an opinion: a PENDING task whose every
// dependency has SUCCEEDED is ready, and nothing else is. Cycles are rejected
// when a plan revision is validated, not discovered when the scheduler starves.
//

import type { AgenticTaskStatus } from "../../../../shared/agent/agentic-run";

export type TaskNode = {
  id: string;
  status: AgenticTaskStatus;
  dependencies: readonly string[];
};

export const TERMINAL_TASK_STATUSES: readonly AgenticTaskStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

export const isTerminalTaskStatus = (status: AgenticTaskStatus): boolean =>
  TERMINAL_TASK_STATUSES.includes(status);

export type PlanValidation =
  | { ok: true; order: string[] }
  | { ok: false; reason: "cycle"; cycle: string[] }
  | { ok: false; reason: "unknown-dependency"; taskId: string; dependencyId: string }
  | { ok: false; reason: "duplicate-task"; taskId: string }
  | { ok: false; reason: "self-dependency"; taskId: string };

export function validatePlan(nodes: readonly TaskNode[]): PlanValidation {
  const byId = new Map<string, TaskNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) return { ok: false, reason: "duplicate-task", taskId: node.id };
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    for (const dependencyId of node.dependencies) {
      if (dependencyId === node.id) return { ok: false, reason: "self-dependency", taskId: node.id };
      if (!byId.has(dependencyId)) {
        return { ok: false, reason: "unknown-dependency", taskId: node.id, dependencyId };
      }
    }
  }

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, node.dependencies.length);
    for (const dependencyId of node.dependencies) {
      const list = dependents.get(dependencyId);
      if (list) list.push(node.id);
      else dependents.set(dependencyId, [node.id]);
    }
  }

  const queue = nodes.filter((node) => node.dependencies.length === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const dependentId of dependents.get(id) ?? []) {
      const remaining = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, remaining);
      if (remaining === 0) queue.push(dependentId);
    }
  }

  if (order.length === nodes.length) return { ok: true, order };
  return { ok: false, reason: "cycle", cycle: findCycle(byId) };
}

function findCycle(byId: ReadonlyMap<string, TaskNode>): string[] {
  const state = new Map<string, "open" | "closed">();
  const stack: string[] = [];
  let found: string[] = [];

  const walk = (id: string): boolean => {
    const seen = state.get(id);
    if (seen === "closed") return false;
    if (seen === "open") {
      const start = stack.indexOf(id);
      found = stack.slice(start === -1 ? 0 : start).concat(id);
      return true;
    }
    state.set(id, "open");
    stack.push(id);
    for (const dependencyId of byId.get(id)?.dependencies ?? []) {
      if (walk(dependencyId)) return true;
    }
    stack.pop();
    state.set(id, "closed");
    return false;
  };

  for (const id of byId.keys()) {
    if (walk(id)) break;
  }
  return found;
}

export type ReadinessResolution = {
  ready: string[];
  blocked: string[];
  unchanged: string[];
};

//
// Derives readiness for every non-terminal task. A task whose dependency
// FAILED or was CANCELLED is BLOCKED, not merely waiting: nothing downstream
// will ever satisfy it without a plan revision.
//
export function resolveReadiness(nodes: readonly TaskNode[]): ReadinessResolution {
  const statusById = new Map(nodes.map((node) => [node.id, node.status] as const));
  const ready: string[] = [];
  const blocked: string[] = [];
  const unchanged: string[] = [];

  for (const node of nodes) {
    if (isTerminalTaskStatus(node.status) || node.status === "RUNNING" || node.status === "WAITING_USER") {
      unchanged.push(node.id);
      continue;
    }
    let satisfied = true;
    let dead = false;
    for (const dependencyId of node.dependencies) {
      const status = statusById.get(dependencyId);
      if (status === "SUCCEEDED") continue;
      satisfied = false;
      if (status === "FAILED" || status === "CANCELLED") dead = true;
    }
    if (dead) blocked.push(node.id);
    else if (satisfied) ready.push(node.id);
    else blocked.push(node.id);
  }

  return { ready, blocked, unchanged };
}

//
// The scheduler picks one task at a time: local inference concurrency is 1 and
// fabricating a second slot would only queue behind the same card.
//
export function selectNextTask(nodes: readonly TaskNode[]): string | null {
  const running = nodes.find((node) => node.status === "RUNNING");
  if (running) return running.id;
  const { ready } = resolveReadiness(nodes);
  if (ready.length === 0) return null;
  const order = validatePlan(nodes);
  if (!order.ok) return ready[0] ?? null;
  const readySet = new Set(ready);
  return order.order.find((id) => readySet.has(id)) ?? ready[0] ?? null;
}

export function planIsSettled(nodes: readonly TaskNode[]): boolean {
  return nodes.every((node) => isTerminalTaskStatus(node.status));
}
