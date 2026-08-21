//
// The durable scheduler.
//
// This is the module that fixes the defect the P0 handoff measured: compaction
// is a memory operation, and its return value was being used as the answer to
// "should the agent keep working?". Here the answer comes from the durable
// task ledger instead. A compaction checkpoints, rewrites the active context,
// rebuilds the working set and schedules the next inference itself — the same
// task stays RUNNING, and nobody types "continue".
//

import {
  computeContextBudget,
  preflightContext,
  resolvePostCompactionTarget,
  type ContextBudget,
  type ContextBudgetPolicy,
  DEFAULT_CONTEXT_BUDGET_POLICY,
} from "./context-budget";
import type { AgenticCapability } from "./capability";
import type { AgenticRun, AgenticTask } from "./contract";
import { resolveReadiness, selectNextTask, validatePlan, type TaskNode } from "./dag";
import { runCompaction, type AgenticInferenceSession } from "./scheduler-session";
import {
  DEFAULT_STALL_POLICY,
  errorSignature,
  evaluateStall,
  progressFingerprint,
  type StallPolicy,
  type StallState,
} from "./stall";
import type { AgenticStore, TaskSeed } from "./store";
import { applyEvidence, acceptanceRejection, parseTurnReport } from "./turn-report";
import { buildWorkingSet, renderWorkingSet, workingSetTokens } from "./working-set";

export const MAX_INEFFECTIVE_COMPACTIONS = 2;

export type SchedulerStep =
  | { kind: "idle"; reason: string }
  | { kind: "resumed"; taskId: string; compacted: boolean }
  | { kind: "waiting-user"; taskId: string; question: string }
  | { kind: "replanned"; revision: number; reason: string }
  | { kind: "completed" }
  | { kind: "failed"; reason: string };

export type ReplanInput = {
  run: AgenticRun;
  tasks: AgenticTask[];
  failingTask: AgenticTask;
  reason: string;
};

export type AgenticSchedulerOptions = {
  store: AgenticStore;
  session: (run: AgenticRun) => AgenticInferenceSession;
  budgetPolicy?: ContextBudgetPolicy;
  stallPolicy?: StallPolicy;
  replan?: (input: ReplanInput) => TaskSeed[];
};

const defaultReplan = ({ tasks, failingTask, reason }: ReplanInput): TaskSeed[] => {
  const diagnosticTitle = `Diagnose: ${failingTask.title}`;
  if (tasks.some((task) => task.title === diagnosticTitle)) {
    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dependencies: task.dependencies,
      acceptance: task.acceptance,
    }));
  }
  const seeds: TaskSeed[] = [];
  for (const task of tasks) {
    if (task.id === failingTask.id) {
      seeds.push({
        title: diagnosticTitle,
        description: `Establish why the previous approach made no progress. ${reason}`,
        dependencies: task.dependencies,
        acceptance: [
          {
            id: "diagnosis",
            description: "A stated cause backed by concrete observed evidence",
            kind: "assertion",
            satisfied: false,
            evidence: null,
          },
        ],
      });
      seeds.push({
        id: task.id,
        title: task.title,
        description: task.description,
        dependencies: [...task.dependencies, diagnosticTitle],
        acceptance: task.acceptance,
      });
      continue;
    }
    seeds.push({
      id: task.id,
      title: task.title,
      description: task.description,
      dependencies: task.dependencies,
      acceptance: task.acceptance,
    });
  }
  return seeds;
};

export function createAgenticScheduler(options: AgenticSchedulerOptions) {
  const store = options.store;
  const budgetPolicy = options.budgetPolicy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
  const stallPolicy = options.stallPolicy ?? DEFAULT_STALL_POLICY;
  const replan = options.replan ?? defaultReplan;
  const stallByTask = new Map<string, StallState>();
  const ineffectiveCompactions = new Map<string, number>();
  const sessions = new Map<string, AgenticInferenceSession>();

  //
  // Exactly one session object per Run. The adapter that fronts a real backend
  // is stateful — it derives a turn's spend as a delta against what it saw
  // last — so asking the factory again on every step would hand back an object
  // with no memory, and every turn would report zero tokens.
  //
  const sessionFor = (run: AgenticRun): AgenticInferenceSession => {
    const existing = sessions.get(run.id);
    if (existing) return existing;
    const created = options.session(run);
    sessions.set(run.id, created);
    return created;
  };

  const nodesOf = (tasks: AgenticTask[]): TaskNode[] =>
    tasks.map((task) => ({ id: task.id, status: task.status, dependencies: task.dependencies }));

  const budgetFor = (run: AgenticRun, capability: AgenticCapability): ContextBudget =>
    computeContextBudget({ ...capability, contextWindow: run.contextWindow }, budgetPolicy);

  const applyReadiness = (runId: string): AgenticTask[] => {
    const tasks = store.listTasks(runId);
    const { ready, blocked } = resolveReadiness(nodesOf(tasks));
    const readySet = new Set(ready);
    const blockedSet = new Set(blocked);
    for (const task of tasks) {
      if (readySet.has(task.id) && task.status !== "READY") store.updateTask(task.id, { status: "READY" });
      else if (blockedSet.has(task.id) && task.status !== "BLOCKED")
        store.updateTask(task.id, { status: "BLOCKED" });
    }
    return store.listTasks(runId);
  };

  const currentWorkingSet = (run: AgenticRun, activeTask: AgenticTask | null, tail: string[], errors: string[]) =>
    buildWorkingSet({
      run,
      tasks: store.listTasks(run.id),
      activeTask,
      operations: store.listOperations(run.id),
      artifacts: store.listArtifacts(run.id),
      events: store.listEvents(run.id),
      recentTail: tail,
      unresolvedErrors: errors,
    });

  const compactAndRebuild = async (
    run: AgenticRun,
    task: AgenticTask | null,
    session: AgenticInferenceSession,
    budget: ContextBudget,
    reason: string,
    tail: string[],
    errors: string[],
  ): Promise<{ prompt: string; effective: boolean }> => {
    const workingSet = currentWorkingSet(run, task, tail, errors);
    const rendered = renderWorkingSet(workingSet);
    const required = workingSetTokens(workingSet);
    const target = resolvePostCompactionTarget(budget, required);

    store.appendEvent({
      runId: run.id,
      taskId: task?.id ?? null,
      type: "COMPACTION_STARTED",
      summary: reason,
    });

    const outcome = await runCompaction(session, rendered, store.now(), store.now);
    const checkpoint = store.recordCheckpoint({
      runId: run.id,
      taskId: task?.id ?? null,
      reason,
      tokensBefore: outcome.tokensBefore,
      tokensAfter: outcome.tokensAfter,
      targetTokens: target.target,
      usableLimit: budget.usableLimit,
      durationMs: outcome.durationMs,
      workingSet,
    });
    store.updateRun(run.id, {
      compactionCount: run.compactionCount + 1,
      latestCheckpointId: checkpoint.id,
    });
    store.appendEvent({
      runId: run.id,
      taskId: task?.id ?? null,
      type: "COMPACTED",
      summary: `${outcome.tokensBefore} -> ${outcome.tokensAfter} tokens · checkpoint #${checkpoint.sequence}`,
      detail: {
        tokensBefore: outcome.tokensBefore,
        tokensAfter: outcome.tokensAfter,
        targetTokens: target.target,
        usableLimit: budget.usableLimit,
        belowFloor: target.belowFloor,
        aboveCeiling: target.aboveCeiling,
        durationMs: outcome.durationMs,
      },
    });
    return { prompt: rendered, effective: outcome.effective };
  };

  const launch = async (
    run: AgenticRun,
    task: AgenticTask,
    session: AgenticInferenceSession,
    capability: AgenticCapability,
    tail: string[],
    errors: string[],
  ): Promise<SchedulerStep> => {
    const budget = budgetFor(run, capability);
    const workingSet = currentWorkingSet(run, task, tail, errors);
    let prompt = renderWorkingSet(workingSet);
    const reading = await session.readContext();
    const required = workingSetTokens(workingSet);
    //
    // The usable limit already has the output reserve subtracted out of it, so
    // the expected next operation is the prompt alone. Adding the reserve back
    // here counted it twice and made a narrow budget look overflowed before
    // the session held anything at all.
    //
    const decision = preflightContext({
      budget,
      activeTokens: reading.tokens,
      expectedNextOperationTokens: required,
    });

    let compacted = false;
    //
    // Compaction can only remove what is NOT the working set. A session
    // already at or below what the task needs has nothing to gain from one,
    // and asking the backend to compact it is how a fresh Run under a narrow
    // budget ended up refused before its first turn.
    //
    if (decision.action !== "proceed" && reading.tokens <= required) {
      store.appendEvent({
        runId: run.id,
        taskId: task.id,
        type: "BUDGET_EXCEEDED",
        summary: "the working set itself exceeds the usable budget; proceeding without compacting",
        detail: { activeTokens: reading.tokens, requiredTokens: required, usableLimit: budget.usableLimit },
      });
    } else if (decision.action !== "proceed") {
      const result = await compactAndRebuild(
        run,
        task,
        session,
        budget,
        decision.action === "externalize" ? "pending payload exceeds the tool reserve" : "context preflight",
        tail,
        errors,
      );
      prompt = result.prompt;
      compacted = true;
      const strikes = result.effective ? 0 : (ineffectiveCompactions.get(run.id) ?? 0) + 1;
      ineffectiveCompactions.set(run.id, strikes);
      if (strikes >= MAX_INEFFECTIVE_COMPACTIONS) {
        const reason = "compaction cannot create headroom; refusing to compact in a circle";
        store.updateRun(run.id, { status: "FAILED", failureReason: reason });
        store.appendEvent({ runId: run.id, taskId: task.id, type: "RUN_FAILED", summary: reason });
        return { kind: "failed", reason };
      }
    }

    const refreshed = store.requireRun(run.id);
    store.updateTask(task.id, {
      status: "RUNNING",
      attemptCount: task.attemptCount + 1,
      startedAtMs: task.startedAtMs ?? store.now(),
    });
    store.updateRun(refreshed.id, { status: "RUNNING", activeTaskId: task.id });

    const agent = store.listAgents(refreshed.id)[0];
    if (agent) {
      store.startAttempt({
        runId: refreshed.id,
        taskId: task.id,
        agentId: agent.id,
        attempt: task.attemptCount + 1,
      });
      store.updateAgent(agent.id, {
        status: "WORKING",
        currentTaskId: task.id,
        activeContextTokens: reading.tokens,
        contextLimit: budget.usableLimit,
        lastHeartbeatMs: store.now(),
        compactionCount: compacted ? agent.compactionCount + 1 : agent.compactionCount,
      });
    }

    store.appendEvent({
      runId: refreshed.id,
      taskId: task.id,
      type: compacted ? "AGENT_RESUMED" : "AGENT_STARTED",
      summary: compacted ? `resumed ${task.title} automatically after compaction` : task.title,
    });

    await session.prompt(prompt);
    return { kind: "resumed", taskId: task.id, compacted };
  };

  //
  // One durable step. Called after every settled turn; it is the only place
  // allowed to move a Run or a Task, and it never asks the owner anything the
  // ledger can answer.
  //
  const advance = async (runId: string, capability: AgenticCapability): Promise<SchedulerStep> => {
    const run = store.requireRun(runId);
    if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") {
      return { kind: "idle", reason: `run is ${run.status.toLowerCase()}` };
    }
    const session = sessionFor(run);
    const agent = store.listAgents(run.id)[0];

    const usage = session.lastTurnUsage();
    store.addRunUsage(run.id, usage);
    if (agent) store.addAgentUsage(agent.id, usage);

    const lastError = session.lastError();
    const errors = lastError ? [lastError] : [];
    const finalText = session.lastAssistantText();
    const report = parseTurnReport(finalText);
    const tail: string[] = [];

    let tasks = store.listTasks(run.id);
    const activeTask = run.activeTaskId ? (store.getTask(run.activeTaskId) ?? null) : null;

    if (activeTask) {
      const outcome = applyEvidence(activeTask.acceptance, report);
      store.updateTask(activeTask.id, { acceptance: outcome.acceptance });
      for (const criterionId of outcome.newlySatisfied) {
        store.appendEvent({
          runId: run.id,
          taskId: activeTask.id,
          type: "ACCEPTANCE_SATISFIED",
          summary: criterionId,
        });
        tail.push(`acceptance ${criterionId} satisfied`);
      }

      const openAttempts = store.listAttempts(activeTask.id).filter((a) => a.status === "RUNNING");
      const settle = (status: "SUCCEEDED" | "FAILED" | "ABANDONED", error: string | null) => {
        for (const attempt of openAttempts) {
          store.settleAttempt(attempt.id, {
            status,
            outcome: status,
            evidence: outcome.acceptance.filter((c) => c.satisfied).map((c) => `${c.id}: ${c.evidence ?? ""}`),
            error,
          });
        }
      };

      if (report.userQuestion) {
        settle("ABANDONED", null);
        store.updateTask(activeTask.id, { status: "WAITING_USER", blocker: report.userQuestion });
        store.updateRun(run.id, { status: "WAITING_USER" });
        if (agent) store.updateAgent(agent.id, { status: "WAITING" });
        store.appendEvent({
          runId: run.id,
          taskId: activeTask.id,
          type: "TASK_WAITING_USER",
          summary: report.userQuestion,
        });
        return { kind: "waiting-user", taskId: activeTask.id, question: report.userQuestion };
      }

      if (outcome.satisfied) {
        settle("SUCCEEDED", null);
        store.updateTask(activeTask.id, {
          status: "SUCCEEDED",
          resultSummary: firstLine(finalText),
          settledAtMs: store.now(),
          evidence: outcome.acceptance.map((c) => `${c.id}: ${c.evidence ?? ""}`),
        });
        store.appendEvent({
          runId: run.id,
          taskId: activeTask.id,
          type: "TASK_SUCCEEDED",
          summary: activeTask.title,
        });
        stallByTask.delete(activeTask.id);
      } else {
        const rejection = acceptanceRejection(outcome, report);
        if (rejection) {
          store.appendEvent({
            runId: run.id,
            taskId: activeTask.id,
            type: "ACCEPTANCE_REJECTED",
            summary: rejection,
          });
          errors.push(rejection);
        }
        if (report.blockedReason) errors.push(`blocked: ${report.blockedReason}`);
        settle("FAILED", rejection ?? report.blockedReason ?? lastError);

        const fingerprint = progressFingerprint({
          task: store.requireTask(activeTask.id),
          operations: store.listOperations(run.id),
          artifacts: store.listArtifacts(run.id),
          errorSignature: errorSignature(rejection ?? report.blockedReason ?? lastError),
        });
        const evaluated = evaluateStall({
          state: stallByTask.get(activeTask.id) ?? { fingerprint: null, repeats: 0 },
          fingerprint,
          attemptCount: store.requireTask(activeTask.id).attemptCount,
          planRevisions: run.planRevision - 1,
          policy: stallPolicy,
        });
        stallByTask.set(activeTask.id, evaluated.state);

        if (evaluated.verdict.kind === "give-up") {
          store.updateTask(activeTask.id, {
            status: "FAILED",
            blocker: evaluated.verdict.reason,
            settledAtMs: store.now(),
          });
          store.updateRun(run.id, { status: "FAILED", failureReason: evaluated.verdict.reason });
          store.appendEvent({
            runId: run.id,
            taskId: activeTask.id,
            type: "RUN_FAILED",
            summary: evaluated.verdict.reason,
          });
          return { kind: "failed", reason: evaluated.verdict.reason };
        }

        if (evaluated.verdict.kind === "replan") {
          const seeds = replan({
            run,
            tasks: store.listTasks(run.id),
            failingTask: store.requireTask(activeTask.id),
            reason: evaluated.verdict.reason,
          });
          const validation = validatePlan(seedNodes(seeds));
          if (validation.ok) {
            const revised = store.recordPlanRevision({
              runId: run.id,
              reason: evaluated.verdict.reason,
              tasks: seeds,
            });
            store.appendEvent({
              runId: run.id,
              taskId: activeTask.id,
              type: "REPLAN",
              summary: evaluated.verdict.reason,
            });
            stallByTask.delete(activeTask.id);
            store.updateTask(activeTask.id, { status: "PENDING" });
            applyReadiness(run.id);
            return { kind: "replanned", revision: revised.revision, reason: evaluated.verdict.reason };
          }
        }

        store.updateTask(activeTask.id, { status: "PENDING" });
      }
    }

    tasks = applyReadiness(run.id);
    const nextTaskId = selectNextTask(nodesOf(tasks));
    if (!nextTaskId) {
      const settledRun = store.requireRun(run.id);
      const allSucceeded = tasks.every((task) => task.status === "SUCCEEDED");
      const status = allSucceeded ? "COMPLETED" : "FAILED";
      store.updateRun(settledRun.id, {
        status,
        activeTaskId: null,
        resultSummary: allSucceeded ? firstLine(finalText) : null,
        failureReason: allSucceeded ? null : "no task is runnable and the plan is not satisfied",
      });
      if (agent) store.updateAgent(agent.id, { status: "FINISHED", currentTaskId: null });
      store.appendEvent({
        runId: settledRun.id,
        type: allSucceeded ? "RUN_COMPLETED" : "RUN_FAILED",
        summary: allSucceeded ? "all tasks satisfied" : "no runnable task remains",
      });
      return allSucceeded
        ? { kind: "completed" }
        : { kind: "failed", reason: "no runnable task remains" };
    }

    const nextTask = store.requireTask(nextTaskId);
    return launch(store.requireRun(run.id), nextTask, session, capability, tail, errors);
  };

  return {
    advance,
    applyReadiness,
    launch,
    budgetFor,
    sessionFor,
  };
}

const firstLine = (text: string): string => {
  const line = text.split("\n").find((entry) => entry.trim().length > 0);
  return (line ?? "").trim().slice(0, 400);
};

//
// A revision names dependencies in whichever space the caller had available —
// a carried task by id, a brand new one by title. Validation happens in that
// mixed space, because the store is what resolves titles to ids on write.
//
export function seedNodes(seeds: readonly TaskSeed[]): TaskNode[] {
  const keyByTitle = new Map(seeds.map((seed, index) => [seed.title, seed.id ?? `seed_${index}`]));
  return seeds.map((seed, index) => ({
    id: seed.id ?? `seed_${index}`,
    status: "PENDING" as const,
    dependencies: seed.dependencies.map((dependency) => keyByTitle.get(dependency) ?? dependency),
  }));
}
