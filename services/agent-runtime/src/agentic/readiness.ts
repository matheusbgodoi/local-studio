import { criterionIsSatisfied, acceptanceReviewReason } from "../../../../shared/agent/acceptance";
import type { AgenticTask } from "./contract";
import { resolveReadiness, type TaskNode } from "./dag";
import type { AgenticStore } from "./store";

const nodesOf = (tasks: readonly AgenticTask[]): TaskNode[] =>
  tasks.map((task) => ({ id: task.id, status: task.status, dependencies: task.dependencies }));

export function applyReadiness(store: AgenticStore, runId: string): AgenticTask[] {
  for (const task of store.listTasks(runId)) {
    if (task.status === "SUCCEEDED" && acceptanceReviewReason(task.acceptance)) {
      store.updateTask(task.id, {
        status: "WAITING_USER",
        blocker: acceptanceReviewReason(task.acceptance),
      });
    }
  }
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
  if (
    task.acceptance.length === 0
      ? !claimedComplete
      : task.acceptance.some((c) => !criterionIsSatisfied(c))
  ) {
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
