import { createHash } from "node:crypto";
import type { OperationalCheck } from "../../../../shared/agent/operational-check";
import type { AgenticRun } from "./contract";
import type { AgenticStore } from "./store";

export type ExecutionOwnership = Readonly<{
  runId: string;
  taskId: string;
  agentId: string;
  attemptId: string;
  planRevision: number;
  runtimeSessionId: string;
}>;

export const checkSpecHash = (check: OperationalCheck): string =>
  createHash("sha256").update(JSON.stringify(
    check.kind === "command"
      ? [check.kind, check.command, check.cwd]
      : [check.kind, check.path, check.sha256],
  )).digest("hex");

export function captureExecutionOwnership(
  store: AgenticStore,
  run: AgenticRun | null,
  runtimeSessionId: string,
): ExecutionOwnership | null {
  if (!run || run.status !== "RUNNING") return null;
  const agent = store.listAgents(run.id).find((candidate) =>
    `${run.sessionId}#${candidate.id}` === runtimeSessionId && candidate.status === "WORKING",
  );
  if (!agent?.currentTaskId) return null;
  const task = store.getTask(agent.currentTaskId);
  if (!task || task.status !== "RUNNING" || task.agentId !== agent.id || task.planRevision !== run.planRevision) return null;
  const attempts = store.listRunningAttempts(run.id).filter((attempt) =>
    attempt.agentId === agent.id && attempt.taskId === task.id && attempt.attempt === task.attemptCount,
  );
  if (attempts.length !== 1) return null;
  return Object.freeze({
    runId: run.id, taskId: task.id, agentId: agent.id, attemptId: attempts[0]!.id,
    planRevision: run.planRevision, runtimeSessionId,
  });
}

export function executionOwnershipIsCurrent(store: AgenticStore, owner: ExecutionOwnership): boolean {
  const current = captureExecutionOwnership(store, store.getRun(owner.runId) ?? null, owner.runtimeSessionId);
  return current !== null && Object.keys(owner).every((key) =>
    owner[key as keyof ExecutionOwnership] === current[key as keyof ExecutionOwnership],
  );
}
