//
// The control plane the served model proposes against.
//
// The model never touches the store. It proposes a plan, a revision or a
// progress report; this module validates the proposal, generates every id,
// enforces the DAG and the acceptance gate, and only then commits. A malformed
// or dishonest proposal is rejected with a reason the model can act on, which
// is the whole difference between "the LLM drives" and "the LLM has a database
// handle".
//

import type { AcceptanceCriterion, AgenticTask } from "./contract";
import { validatePlan } from "./dag";
import type { AgenticStore, TaskSeed } from "./store";

//
// Bounds exist so a trivial request cannot become a twelve-task DAG, and so a
// confused model cannot fill the store. They are deliberately generous enough
// that real work fits.
//
export const MAX_TASKS_PER_PLAN = 12;
export const MAX_CRITERIA_PER_TASK = 6;
export const MAX_AGENTS_PER_RUN = 4;
export const MAX_GOAL_LENGTH = 2_000;
export const MAX_TITLE_LENGTH = 160;
export const MAX_TEXT_LENGTH = 4_000;

export type ProposedTask = {
  title: string;
  description: string;
  dependsOn?: string[];
  acceptance: string[];
};

export type ProposedAgent = {
  name: string;
  role: string;
  tasks?: string[];
};

export type PlanProposal = {
  goal: string;
  tasks: ProposedTask[];
  agents?: ProposedAgent[];
};

export type ValidationFailure = { ok: false; reason: string };

export type ValidatedPlan = {
  ok: true;
  goal: string;
  seeds: TaskSeed[];
  agents: { name: string; role: string; taskTitles: string[] }[];
};

const trimmed = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean) : [];

const criterionId = (taskIndex: number, index: number): string => `t${taskIndex + 1}c${index + 1}`;

export function validateProposal(input: unknown): ValidatedPlan | ValidationFailure {
  if (!input || typeof input !== "object") return { ok: false, reason: "the proposal must be an object" };
  const proposal = input as Record<string, unknown>;

  const goal = trimmed(proposal.goal, MAX_GOAL_LENGTH);
  if (!goal) return { ok: false, reason: "goal is required" };

  const rawTasks = Array.isArray(proposal.tasks) ? proposal.tasks : [];
  if (rawTasks.length === 0) return { ok: false, reason: "at least one task is required" };
  if (rawTasks.length > MAX_TASKS_PER_PLAN) {
    return {
      ok: false,
      reason: `at most ${MAX_TASKS_PER_PLAN} tasks; split the work coarsely rather than enumerating every step`,
    };
  }

  const titles = new Set<string>();
  const seeds: TaskSeed[] = [];

  for (const [index, raw] of rawTasks.entries()) {
    if (!raw || typeof raw !== "object") return { ok: false, reason: `task ${index + 1} must be an object` };
    const task = raw as Record<string, unknown>;
    const title = trimmed(task.title, MAX_TITLE_LENGTH);
    if (!title) return { ok: false, reason: `task ${index + 1} needs a title` };
    if (titles.has(title)) return { ok: false, reason: `two tasks share the title "${title}"` };
    titles.add(title);

    const acceptance = asStringArray(task.acceptance);
    if (acceptance.length === 0) {
      return {
        ok: false,
        reason: `task "${title}" needs at least one acceptance criterion stating what evidence would prove it done`,
      };
    }
    if (acceptance.length > MAX_CRITERIA_PER_TASK) {
      return { ok: false, reason: `task "${title}" has more than ${MAX_CRITERIA_PER_TASK} acceptance criteria` };
    }

    seeds.push({
      title,
      description: trimmed(task.description, MAX_TEXT_LENGTH) || title,
      dependencies: asStringArray(task.dependsOn),
      acceptance: acceptance.map((description, position): AcceptanceCriterion => ({
        id: criterionId(index, position),
        description: description.slice(0, MAX_TEXT_LENGTH),
        kind: "assertion",
        satisfied: false,
        evidence: null,
      })),
    });
  }

  for (const seed of seeds) {
    for (const dependency of seed.dependencies) {
      if (!titles.has(dependency)) {
        return { ok: false, reason: `task "${seed.title}" depends on "${dependency}", which is not in the plan` };
      }
    }
  }

  const validation = validatePlan(
    seeds.map((seed) => ({ id: seed.title, status: "PENDING" as const, dependencies: seed.dependencies })),
  );
  if (!validation.ok) {
    const detail = validation.reason === "cycle" ? validation.cycle.join(" -> ") : validation.reason;
    return { ok: false, reason: `the plan is not a DAG (${detail})` };
  }

  const rawAgents = Array.isArray(proposal.agents) ? proposal.agents : [];
  if (rawAgents.length > MAX_AGENTS_PER_RUN) {
    return { ok: false, reason: `at most ${MAX_AGENTS_PER_RUN} logical agents` };
  }
  const agents: ValidatedPlan["agents"] = [];
  const names = new Set<string>();
  for (const [index, raw] of rawAgents.entries()) {
    if (!raw || typeof raw !== "object") return { ok: false, reason: `agent ${index + 1} must be an object` };
    const agent = raw as Record<string, unknown>;
    const name = trimmed(agent.name, MAX_TITLE_LENGTH);
    if (!name) return { ok: false, reason: `agent ${index + 1} needs a name` };
    if (names.has(name)) return { ok: false, reason: `two agents share the name "${name}"` };
    names.add(name);
    const taskTitles = asStringArray(agent.tasks);
    for (const title of taskTitles) {
      if (!titles.has(title)) {
        return { ok: false, reason: `agent "${name}" is assigned "${title}", which is not in the plan` };
      }
    }
    agents.push({ name, role: trimmed(agent.role, MAX_TITLE_LENGTH) || "generalist", taskTitles });
  }

  return { ok: true, goal, seeds, agents };
}

export type ProgressReport = {
  evidence: { criterion: string; evidence: string }[];
  complete: boolean;
  blocked: string | null;
  needsUser: string | null;
};

export function validateProgress(input: unknown): ProgressReport | ValidationFailure {
  if (!input || typeof input !== "object") return { ok: false, reason: "the report must be an object" };
  const report = input as Record<string, unknown>;
  const rawEvidence = Array.isArray(report.evidence) ? report.evidence : [];
  const evidence: ProgressReport["evidence"] = [];
  for (const raw of rawEvidence) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const criterion = trimmed(entry.criterion, MAX_TITLE_LENGTH);
    const proof = trimmed(entry.evidence, MAX_TEXT_LENGTH);
    if (!criterion || !proof) {
      return { ok: false, reason: "each evidence entry needs both a criterion id and the evidence itself" };
    }
    evidence.push({ criterion, evidence: proof });
  }
  return {
    evidence,
    complete: report.complete === true,
    blocked: trimmed(report.blocked, MAX_TEXT_LENGTH) || null,
    needsUser: trimmed(report.needsUser, MAX_TEXT_LENGTH) || null,
  };
}

//
// Applying a report is a validated transition, not a write-through. Evidence
// lands only on criteria that exist, the gate stays the runtime's to enforce,
// and the model is told exactly what is still outstanding.
//
export function applyProgressReport(
  store: AgenticStore,
  task: AgenticTask,
  report: ProgressReport,
  turnId: number,
): { outstanding: string[]; satisfied: boolean; unknownCriteria: string[] } {
  const byId = new Map(task.acceptance.map((criterion) => [criterion.id, criterion] as const));
  const unknownCriteria: string[] = [];
  const next = task.acceptance.map((criterion) => ({ ...criterion }));

  for (const entry of report.evidence) {
    const target = byId.get(entry.criterion);
    if (!target) {
      unknownCriteria.push(entry.criterion);
      continue;
    }
    const slot = next.find((criterion) => criterion.id === entry.criterion);
    if (!slot || slot.satisfied) continue;
    slot.satisfied = true;
    slot.evidence = entry.evidence;
    store.recordSignal({
      runId: task.runId,
      taskId: task.id,
      agentId: task.agentId,
      turnId,
      kind: "evidence",
      detail: { criterion: entry.criterion, evidence: entry.evidence },
    });
    store.appendEvent({
      runId: task.runId,
      taskId: task.id,
      type: "ACCEPTANCE_SATISFIED",
      summary: entry.criterion,
    });
  }

  store.updateTask(task.id, { acceptance: next });

  if (report.complete) {
    store.recordSignal({
      runId: task.runId,
      taskId: task.id,
      agentId: task.agentId,
      turnId,
      kind: "complete",
      detail: {},
    });
  }
  if (report.blocked) {
    store.recordSignal({
      runId: task.runId,
      taskId: task.id,
      agentId: task.agentId,
      turnId,
      kind: "blocked",
      detail: { reason: report.blocked },
    });
  }
  if (report.needsUser) {
    store.recordSignal({
      runId: task.runId,
      taskId: task.id,
      agentId: task.agentId,
      turnId,
      kind: "needs_user",
      detail: { question: report.needsUser },
    });
  }

  const outstanding = next.filter((criterion) => !criterion.satisfied).map((criterion) => criterion.id);
  return { outstanding, satisfied: outstanding.length === 0, unknownCriteria };
}
