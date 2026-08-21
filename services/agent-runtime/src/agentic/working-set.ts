//
// Working-set reconstruction.
//
// Compaction is not "clear everything" and it is not a three-thousand-token
// souvenir. It rebuilds, from the durable store rather than from the messages
// being discarded, the smallest context in which the UNFINISHED task can still
// be finished: the goal, the plan revision, the task, its acceptance criteria,
// the dependency outputs it actually needs, the decisions taken, the artifact
// pointers, any tool call still awaiting its result, the unresolved errors and
// the next action.
//

import type {
  AgenticArtifact,
  AgenticEvent,
  AgenticRun,
  AgenticTask,
  AgenticToolOperation,
  AgenticWorkingSet,
} from "./contract";
import { estimateTokens } from "./store-operations";

const DECISION_EVENT_TYPES = new Set([
  "PLAN_CREATED",
  "PLAN_REVISED",
  "TASK_SUCCEEDED",
  "TASK_FAILED",
  "ACCEPTANCE_REJECTED",
  "REPLAN",
]);

const MAX_DECISIONS = 12;
const MAX_ARTIFACT_REFS = 12;
const MAX_TAIL = 8;

export type WorkingSetInput = {
  run: AgenticRun;
  tasks: AgenticTask[];
  activeTask: AgenticTask | null;
  operations: AgenticToolOperation[];
  artifacts: AgenticArtifact[];
  events: AgenticEvent[];
  recentTail: string[];
  unresolvedErrors: string[];
};

export function buildWorkingSet(input: WorkingSetInput): AgenticWorkingSet {
  const byId = new Map(input.tasks.map((task) => [task.id, task] as const));
  const dependencyOutputs = (input.activeTask?.dependencies ?? [])
    .map((id) => byId.get(id))
    .filter((task): task is AgenticTask => Boolean(task))
    .map((task) => ({
      taskId: task.id,
      summary: task.resultSummary ?? `${task.title} — ${task.status.toLowerCase()}`,
    }));

  const decisions = input.events
    .filter((event) => DECISION_EVENT_TYPES.has(event.type))
    .slice(-MAX_DECISIONS)
    .map((event) => `${event.type}: ${event.summary}`);

  const artifactRefs = input.artifacts
    .filter((artifact) => artifact.taskId === null || artifact.taskId === input.activeTask?.id)
    .slice(-MAX_ARTIFACT_REFS)
    .map((artifact) => ({ id: artifact.id, label: artifact.label, preview: artifact.preview }));

  const pendingToolCalls = input.operations
    .filter((operation) => operation.status === "STARTED" || operation.status === "UNKNOWN")
    .map((operation) => ({
      idempotencyKey: operation.idempotencyKey,
      action: operation.action,
      status: operation.status,
    }));

  return {
    goal: input.run.goal,
    planRevision: input.run.planRevision,
    taskId: input.activeTask?.id ?? null,
    taskTitle: input.activeTask?.title ?? null,
    acceptance: input.activeTask?.acceptance ?? [],
    dependencyOutputs,
    decisions,
    artifactRefs,
    pendingToolCalls,
    unresolvedErrors: input.unresolvedErrors,
    recentTail: input.recentTail.slice(-MAX_TAIL),
    nextAction: nextActionFor(input.activeTask),
  };
}

function nextActionFor(task: AgenticTask | null): string {
  if (!task) return "Select the next ready task from the plan.";
  const outstanding = task.acceptance.filter((criterion) => !criterion.satisfied);
  if (outstanding.length === 0) {
    return `Confirm the acceptance evidence for "${task.title}" and report TASK_COMPLETE.`;
  }
  return `Continue "${task.title}" until this is satisfied: ${outstanding[0]?.description ?? ""}`;
}

//
// The rendered working set is the resume prompt. It states the task, the
// evidence still owed and the next action, so the model never has to infer
// from a truncated transcript what it was in the middle of doing.
//
export function renderWorkingSet(workingSet: AgenticWorkingSet): string {
  const lines: string[] = [];
  lines.push(`GOAL: ${workingSet.goal}`);
  lines.push(`PLAN REVISION: ${workingSet.planRevision}`);
  if (workingSet.taskTitle) {
    lines.push(`CURRENT TASK: ${workingSet.taskTitle}`);
  }
  if (workingSet.acceptance.length > 0) {
    lines.push("ACCEPTANCE CRITERIA:");
    for (const criterion of workingSet.acceptance) {
      const mark = criterion.satisfied ? "satisfied" : "outstanding";
      const evidence = criterion.evidence ? ` — evidence: ${criterion.evidence}` : "";
      lines.push(`  - [${criterion.id}] ${criterion.description} (${mark})${evidence}`);
    }
  }
  if (workingSet.dependencyOutputs.length > 0) {
    lines.push("DEPENDENCY OUTPUTS:");
    for (const output of workingSet.dependencyOutputs) {
      lines.push(`  - ${output.taskId}: ${output.summary}`);
    }
  }
  if (workingSet.decisions.length > 0) {
    lines.push("DECISIONS SO FAR:");
    for (const decision of workingSet.decisions) lines.push(`  - ${decision}`);
  }
  if (workingSet.artifactRefs.length > 0) {
    lines.push("ARTIFACTS (retrievable by id, do not re-paste):");
    for (const artifact of workingSet.artifactRefs) {
      lines.push(`  - ${artifact.id} ${artifact.label}`);
    }
  }
  if (workingSet.pendingToolCalls.length > 0) {
    lines.push("TOOL OPERATIONS AWAITING RECONCILIATION:");
    for (const call of workingSet.pendingToolCalls) {
      lines.push(`  - ${call.action} (${call.status}) key=${call.idempotencyKey}`);
    }
  }
  if (workingSet.unresolvedErrors.length > 0) {
    lines.push("UNRESOLVED ERRORS:");
    for (const error of workingSet.unresolvedErrors) lines.push(`  - ${error}`);
  }
  if (workingSet.recentTail.length > 0) {
    lines.push("RECENT ACTIVITY:");
    for (const entry of workingSet.recentTail) lines.push(`  - ${entry}`);
  }
  lines.push(`NEXT ACTION: ${workingSet.nextAction}`);
  lines.push(
    "Continue the work. Report TASK_EVIDENCE <criterion-id>: <evidence> as each criterion is met, TASK_COMPLETE when all are, TASK_BLOCKED <reason> if you cannot proceed, and NEEDS_USER <question> only when a human decision, credential or permission is genuinely required.",
  );
  return lines.join("\n");
}

export function workingSetTokens(workingSet: AgenticWorkingSet): number {
  return estimateTokens(renderWorkingSet(workingSet));
}
