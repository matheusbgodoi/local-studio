//
// Deriving readiness, callable from anywhere that changes the shape of a plan.
//
// This used to live inside the scheduler, which meant a plan only became
// coherent between turns. A capable model does thirty tool calls in one turn:
// it reported a task done and watched it stay RUNNING, saw its dependents stay
// BLOCKED with no dependencies left, and replanned twice against a problem that
// did not exist. Readiness has to follow the facts as they change, not wait for
// the next inference.
//

import type { AgenticTask } from "./contract";
import { resolveReadiness, type TaskNode } from "./dag";
import type { AgenticStore } from "./store";

const nodesOf = (tasks: readonly AgenticTask[]): TaskNode[] =>
  tasks.map((task) => ({ id: task.id, status: task.status, dependencies: task.dependencies }));

export function applyReadiness(store: AgenticStore, runId: string): AgenticTask[] {
  const tasks = store.listTasks(runId);
  const { ready, blocked } = resolveReadiness(nodesOf(tasks));
  const readySet = new Set(ready);
  const blockedSet = new Set(blocked);
  for (const task of tasks) {
    if (readySet.has(task.id) && task.status !== "READY") {
      store.updateTask(task.id, { status: "READY" });
    } else if (blockedSet.has(task.id) && task.status !== "BLOCKED") {
      store.updateTask(task.id, { status: "BLOCKED" });
    }
  }
  return store.listTasks(runId);
}

//
// A task is finished the moment its acceptance criteria are all met and the
// model says so — not one inference later. Settling here is what lets the plan
// move while the model is still working, and what stops it from replanning
// around a task it has already proved.
//
export function settleTaskIfSatisfied(
  store: AgenticStore,
  taskId: string,
  claimedComplete: boolean,
  resultSummary: string | null,
): { settled: boolean; unblocked: string[] } {
  const task = store.getTask(taskId);
  if (!task || task.status === "SUCCEEDED" || task.status === "CANCELLED") {
    return { settled: false, unblocked: [] };
  }
  if (task.acceptance.length === 0 ? !claimedComplete : task.acceptance.some((c) => !c.satisfied)) {
    return { settled: false, unblocked: [] };
  }

  const blockedBefore = new Set(
    store
      .listTasks(task.runId)
      .filter((entry) => entry.status === "BLOCKED" || entry.status === "PENDING")
      .map((entry) => entry.id),
  );

  store.updateTask(task.id, {
    status: "SUCCEEDED",
    settledAtMs: store.now(),
    evidence: task.acceptance.map((c) => `${c.id}: ${c.evidence ?? ""}`),
    ...(resultSummary ? { resultSummary } : {}),
  });
  for (const open of store.listAttempts(task.id).filter((a) => a.status === "RUNNING")) {
    store.settleAttempt(open.id, {
      status: "SUCCEEDED",
      outcome: "every acceptance criterion satisfied",
      evidence: task.acceptance.map((c) => `${c.id}: ${c.evidence ?? ""}`),
    });
  }
  store.appendEvent({
    runId: task.runId,
    taskId: task.id,
    type: "TASK_SUCCEEDED",
    summary: task.title,
  });

  const after = applyReadiness(store, task.runId);
  const unblocked = after
    .filter((entry) => entry.status === "READY" && blockedBefore.has(entry.id))
    .map((entry) => entry.title);

  const active = store.requireRun(task.runId).activeTaskId;
  if (active === task.id) store.updateRun(task.runId, { activeTaskId: null });

  return { settled: true, unblocked };
}
