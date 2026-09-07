import type { AgenticRunStatus, AgenticTaskStatus } from "./contract";
import type { AgenticStore } from "./store";

type TerminalStatus = Extract<AgenticRunStatus, "COMPLETED" | "FAILED" | "CANCELLED">;

function taskStatusFor(runStatus: TerminalStatus): AgenticTaskStatus {
  if (runStatus === "CANCELLED") return "CANCELLED";
  return "FAILED";
}

export function settleTerminalWork(
  store: AgenticStore,
  runId: string,
  status: TerminalStatus,
  reason: string,
): void {
  const unfinishedTasks = store
    .listTasks(runId)
    .filter(
      (task) =>
        task.status !== "SUCCEEDED" && task.status !== "FAILED" && task.status !== "CANCELLED",
    );
  if (status === "COMPLETED" && unfinishedTasks.length > 0) {
    throw new Error("A completed Run cannot contain unfinished tasks");
  }
  for (const attempt of store.listRunningAttempts(runId)) {
    store.settleAttempt(attempt.id, {
      status: status === "FAILED" ? "FAILED" : "INTERRUPTED",
      outcome: reason,
      ...(status === "FAILED" ? { error: reason } : {}),
    });
  }
  for (const task of unfinishedTasks) {
    store.updateTask(task.id, {
      status: taskStatusFor(status),
      blocker: task.blocker ?? reason,
      settledAtMs: store.now(),
    });
  }
  for (const agent of store.listAgents(runId)) {
    store.updateAgent(agent.id, {
      status: status === "COMPLETED" ? "FINISHED" : "INTERRUPTED",
      currentTaskId: null,
    });
  }
}
