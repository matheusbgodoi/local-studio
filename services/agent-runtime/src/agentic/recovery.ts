//
// Crash and restart reconciliation.
//
// An agent whose process is gone while its state says WORKING becomes
// INTERRUPTED, never COMPLETED. Completed tasks are not redone. A
// side-effecting operation that was in flight becomes UNKNOWN so the next
// attempt has to look at the real external state before deciding — the one
// thing a durable runtime must never do is blindly replay a commit.
//

import type { AgenticRun } from "./contract";
import type { AgenticStore } from "./store";

export type RunRecovery = {
  runId: string;
  interruptedAgents: number;
  interruptedAttempts: number;
  resetTasks: string[];
  operationsNeedingReconciliation: string[];
  preservedTasks: string[];
};

export function reconcileRun(store: AgenticStore, run: AgenticRun): RunRecovery {
  const recovery: RunRecovery = {
    runId: run.id,
    interruptedAgents: 0,
    interruptedAttempts: 0,
    resetTasks: [],
    operationsNeedingReconciliation: [],
    preservedTasks: [],
  };

  for (const agent of store.listAgents(run.id)) {
    if (agent.status === "WORKING" || agent.status === "COMPACTING") {
      store.updateAgent(agent.id, { status: "INTERRUPTED", currentTaskId: null });
      recovery.interruptedAgents += 1;
    }
  }

  for (const attempt of store.listRunningAttempts(run.id)) {
    store.settleAttempt(attempt.id, {
      status: "INTERRUPTED",
      outcome: "process ended before the turn settled",
    });
    recovery.interruptedAttempts += 1;
  }

  for (const task of store.listTasks(run.id)) {
    if (task.status === "SUCCEEDED") {
      recovery.preservedTasks.push(task.id);
      continue;
    }
    if (task.status === "RUNNING") {
      store.updateTask(task.id, { status: "PENDING" });
      recovery.resetTasks.push(task.id);
    }
  }

  for (const operation of store.listOperations(run.id)) {
    if (operation.status === "STARTED" && operation.sideEffecting) {
      store.markOperationUnknown(operation.idempotencyKey, "process ended mid-flight");
      recovery.operationsNeedingReconciliation.push(operation.idempotencyKey);
    }
  }

  const summary = `${recovery.interruptedAgents} agent(s) interrupted, ${recovery.resetTasks.length} task(s) reset, ${recovery.preservedTasks.length} task(s) preserved, ${recovery.operationsNeedingReconciliation.length} operation(s) awaiting reconciliation`;
  store.updateRun(run.id, {
    status: "PAUSED",
    activeTaskId: null,
    recoveryState: summary,
  });
  store.appendEvent({ runId: run.id, type: "RUN_RECOVERED", summary, detail: recovery });
  return recovery;
}

export function reconcileAllRuns(store: AgenticStore): RunRecovery[] {
  return store.listUnfinishedRuns().map((run) => reconcileRun(store, run));
}
