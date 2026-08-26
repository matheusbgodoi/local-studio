//
// Committing a validated proposal.
//
// Everything here runs after `control-plane` has said the proposal is
// well-formed. Ids, statuses, agent identity and the acceptance gate are the
// runtime's; the proposal only supplied intent.
//

import type { AgenticCapability } from "./capability";
import { computeContextBudget, type ContextBudgetPolicy } from "./context-budget";
import type { AgenticAgent, AgenticRun, AgenticTask } from "./contract";
import { applyProgressReport, type ProgressReport, type ValidatedPlan } from "./control-plane";
import { applyReadiness, settleTaskIfSatisfied } from "./readiness";
import type { AgenticStore } from "./store";
import { networkService } from "../network";
import type { NetworkPolicy } from "../../../../shared/agent/network-policy";

export type CommittedPlan = {
  run: AgenticRun;
  tasks: AgenticTask[];
  agents: AgenticAgent[];
};

//
// A plan that names no agents gets one. Naming several is how the model says
// the work has independent strands; each becomes a durable agent with its own
// working context, and the tasks it was given carry its id from the start.
//
function assignAgents(
  store: AgenticStore,
  run: AgenticRun,
  capability: AgenticCapability,
  plan: ValidatedPlan,
  contextLimit: number,
): AgenticAgent[] {
  const existing = store.listAgents(run.id);
  const byName = new Map(existing.map((agent) => [agent.name, agent] as const));
  const wanted = plan.agents.length > 0 ? plan.agents : [{ name: "Primary", role: "generalist", taskTitles: [] }];

  const agents: AgenticAgent[] = [];
  for (const proposed of wanted) {
    const already = byName.get(proposed.name);
    if (already) {
      agents.push(already);
      continue;
    }
    agents.push(
      store.createAgent({
        runId: run.id,
        name: proposed.name,
        role: proposed.role,
        modelId: capability.modelId,
        physicalModelId: capability.physicalModelId,
        modelDisplayName: capability.displayName,
        behaviorProfile: capability.behaviorProfile,
        sessionId: run.sessionId,
        piSessionId: null,
        contextLimit,
      }),
    );
  }

  const tasks = store.listTasks(run.id);
  const idByTitle = new Map(tasks.map((task) => [task.title, task.id] as const));
  const fallback = agents[0];

  for (const [index, proposed] of wanted.entries()) {
    const agent = agents[index];
    if (!agent) continue;
    for (const title of proposed.taskTitles) {
      const taskId = idByTitle.get(title);
      if (taskId) store.updateTask(taskId, { agentId: agent.id });
    }
  }
  if (fallback) {
    for (const task of store.listTasks(run.id)) {
      if (!task.agentId) store.updateTask(task.id, { agentId: fallback.id });
    }
  }
  return store.listAgents(run.id);
}

export function createRunFromPlan(
  store: AgenticStore,
  input: {
    plan: ValidatedPlan;
    capability: AgenticCapability;
    sessionId: string;
    piSessionId: string | null;
    cwd: string;
    networkPolicy?: NetworkPolicy;
    budgetPolicy?: ContextBudgetPolicy;
  },
): CommittedPlan {
  const budget = computeContextBudget(input.capability, input.budgetPolicy);
  const run = store.createRun({
    goal: input.plan.goal,
    modelId: input.capability.modelId,
    physicalModelId: input.capability.physicalModelId,
    modelDisplayName: input.capability.displayName,
    behaviorProfile: input.capability.behaviorProfile,
    contextWindow: input.capability.contextWindow,
    usableLimit: budget.usableLimit,
    sessionId: input.sessionId,
    piSessionId: input.piSessionId,
    networkPolicy: input.networkPolicy ?? networkService().sessionPolicy(input.sessionId),
    cwd: input.cwd,
  });
  store.recordPlanRevision({ runId: run.id, reason: "plan proposed by the model", tasks: input.plan.seeds });
  const agents = assignAgents(store, run, input.capability, input.plan, budget.usableLimit);
  store.updateRun(run.id, { status: "PLANNING" });
  applyReadiness(store, run.id);
  return { run: store.requireRun(run.id), tasks: store.listTasks(run.id), agents };
}

export function revisePlanForRun(
  store: AgenticStore,
  input: { runId: string; reason: string; plan: ValidatedPlan; capability: AgenticCapability },
): CommittedPlan {
  const run = store.requireRun(input.runId);
  store.recordPlanRevision({ runId: run.id, reason: input.reason, tasks: input.plan.seeds });
  const agents = assignAgents(store, run, input.capability, input.plan, run.usableLimit);
  store.appendEvent({ runId: run.id, type: "REPLAN", summary: input.reason });
  //
  // A revision changes which tasks are blocked. Leaving that to the next
  // inference showed the model a plan where nothing depended on anything and
  // everything was still BLOCKED.
  //
  applyReadiness(store, run.id);
  return { run: store.requireRun(run.id), tasks: store.listTasks(run.id), agents };
}

export type ProgressOutcome =
  | { ok: false; reason: string; validCriteria?: string[] }
  | {
      ok: true;
      outstanding: string[];
      satisfied: boolean;
      unknownCriteria: string[];
      settled?: boolean;
      unblocked?: string[];
      validCriteria?: string[];
    };

export function reportProgressForTask(
  store: AgenticStore,
  input: { runId: string; taskId: string; report: ProgressReport; turnId: number },
): ProgressOutcome {
  const task = store.getTask(input.taskId);
  if (!task || task.runId !== input.runId) {
    return { ok: false, reason: `task ${input.taskId} does not belong to run ${input.runId}` };
  }
  if (task.status === "SUCCEEDED" || task.status === "CANCELLED") {
    return { ok: false, reason: `task ${input.taskId} is already ${task.status.toLowerCase()}` };
  }
  //
  // A task still waiting on its dependencies has not been worked on, so
  // evidence for it would be a claim about work that has not happened, and
  // satisfying its gate early would let the plan be skipped.
  //
  // Asked of the dependencies themselves rather than of the task's stored
  // label: the label is derived, and a derived value read before its inputs
  // settled is exactly how a task that was ready looked blocked.
  //
  const byId = new Map(store.listTasks(task.runId).map((entry) => [entry.id, entry] as const));
  const unmet = task.dependencies.filter((id) => byId.get(id)?.status !== "SUCCEEDED");
  if (unmet.length > 0) {
    const names = unmet.map((id) => byId.get(id)?.title ?? id);
    return {
      ok: false,
      reason: `task ${input.taskId} still depends on ${names.join(", ")}; finish those first`,
    };
  }
  const applied = applyProgressReport(store, task, input.report, input.turnId);
  //
  // Settle now, while the model is still working. Waiting for the next
  // inference left a proved task RUNNING and its dependents BLOCKED, and the
  // model replanned around a gate that had in fact already been met.
  //
  const settled = settleTaskIfSatisfied(
    store,
    task.id,
    input.report.complete,
    input.report.evidence[0]?.evidence ?? null,
  );
  if (applied.unknownCriteria.length > 0 && applied.outstanding.length > 0) {
    return {
      ok: true,
      ...applied,
      ...settled,
      validCriteria: task.acceptance.map((criterion) => criterion.id),
    } as ProgressOutcome;
  }
  return { ok: true, ...applied, ...settled };
}
