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
import type { AgenticAgent, AgenticRun, AgenticRunStatus, AgenticTask } from "./contract";
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
import { applyEvidence, acceptanceRejection, parseTurnReport, type TurnReport } from "./turn-report";
import type { AgenticTurnSignal } from "./store-signals";
import { buildWorkingSet, renderWorkingSet, workingSetTokens } from "./working-set";

export const MAX_INEFFECTIVE_COMPACTIONS = 2;

export const TERMINAL_RUN_STATUSES: readonly AgenticRunStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

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

export type InferenceGate = <T>(task: () => Promise<T>) => Promise<T>;

//
// The real serialisation happens inside the runtime's own prompt path, where
// every caller funnels through one gate. Gating again here would have the inner
// wait for a slot the outer already holds, so the scheduler's default is a
// pass-through and the option exists for tests that drive a fake backend.
//
export function createSerialGate(): InferenceGate {
  return <T>(task: () => Promise<T>): Promise<T> => task();
}

export type AgenticSchedulerOptions = {
  store: AgenticStore;
  session: (run: AgenticRun, agent: AgenticAgent | null) => AgenticInferenceSession;
  inferenceGate?: InferenceGate;
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
  const consumedTurns = new Map<string, number>();

  //
  // Exactly one session object per Run. The adapter that fronts a real backend
  // is stateful — it derives a turn's spend as a delta against what it saw
  // last — so asking the factory again on every step would hand back an object
  // with no memory, and every turn would report zero tokens.
  //
  //
  // One session object per LOGICAL AGENT. Two agents on one Run hold genuinely
  // independent working contexts, so compacting one must not touch the other;
  // and the adapter that fronts a real backend is stateful, deriving a turn's
  // spend as a delta against what it saw last.
  //
  const sessionFor = (run: AgenticRun, agent: AgenticAgent | null): AgenticInferenceSession => {
    const key = agent ? `${run.id}#${agent.id}` : run.id;
    const existing = sessions.get(key);
    if (existing) return existing;
    const created = options.session(run, agent);
    sessions.set(key, created);
    return created;
  };

  //
  // One local card decodes one thing at a time. Tools, builds and waits may
  // overlap freely; inference may not, and the gate is what makes that true
  // rather than merely intended.
  //
  const gate = options.inferenceGate ?? createSerialGate();

  //
  // The agent a task belongs to, falling back to the Run's first agent. The
  // assignment is made when a plan is committed, so routing a turn to the
  // right working context is a lookup rather than a guess.
  //
  const agentForTask = (runId: string, task: AgenticTask | null): AgenticAgent | null => {
    const agents = store.listAgents(runId);
    if (task?.agentId) {
      const owner = agents.find((entry) => entry.id === task.agentId);
      if (owner) return owner;
    }
    return agents[0] ?? null;
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
  ): Promise<{ prompt: string; effective: boolean; recorded: boolean }> => {
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

    let outcome;
    try {
      outcome = await runCompaction(session, rendered, store.now(), store.now);
    } catch (error) {
      //
      // A backend may refuse to compact a session it considers too short,
      // whatever its token count. That means no headroom can be created here,
      // not that the goal is over: the rebuilt working set is still the right
      // prompt, and the loop guard is what stops a refusal repeating forever.
      //
      const message = error instanceof Error ? error.message : String(error);
      store.appendEvent({
        runId: run.id,
        taskId: task?.id ?? null,
        type: "COMPACTION_REFUSED",
        summary: message,
      });
      return { prompt: rendered, effective: false, recorded: false };
    }
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
    //
    // A backend reports no context usage until the next turn produces some, so
    // immediately after a compaction the reading is often absent rather than
    // zero. Publishing it as zero would be a measurement nobody took; the
    // working set that was just rebuilt is the honest estimate, and the flag
    // says which of the two the reader is looking at.
    //
    const measuredAfter = outcome.tokensAfter > 0;
    store.appendEvent({
      runId: run.id,
      taskId: task?.id ?? null,
      type: "COMPACTED",
      summary: measuredAfter
        ? `${outcome.tokensBefore} -> ${outcome.tokensAfter} tokens · checkpoint #${checkpoint.sequence}`
        : `${outcome.tokensBefore} -> ~${required} tokens · checkpoint #${checkpoint.sequence}`,
      detail: {
        tokensBefore: outcome.tokensBefore,
        tokensAfter: outcome.tokensAfter,
        tokensAfterEstimated: measuredAfter ? null : required,
        afterMeasured: measuredAfter,
        targetTokens: target.target,
        usableLimit: budget.usableLimit,
        belowFloor: target.belowFloor,
        aboveCeiling: target.aboveCeiling,
        durationMs: outcome.durationMs,
      },
    });
    return { prompt: rendered, effective: outcome.effective, recorded: true };
  };

  const launch = async (
    run: AgenticRun,
    task: AgenticTask,
    capability: AgenticCapability,
    tail: string[],
    errors: string[],
  ): Promise<SchedulerStep> => {
    const agent = agentForTask(run.id, task);
    const session = sessionFor(run, agent);
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
    let compactionRecorded = false;
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
      compactionRecorded = result.recorded;
      const strikes = result.effective ? 0 : (ineffectiveCompactions.get(run.id) ?? 0) + 1;
      ineffectiveCompactions.set(run.id, strikes);
      if (strikes >= MAX_INEFFECTIVE_COMPACTIONS) {
        //
        // Name both numbers. "Cannot create headroom" on its own sends the
        // reader looking for a bug; what actually happened is that the usable
        // budget sits below the floor this backend can reach, and the fix is
        // to raise the budget, not to compact harder.
        //
        const reason = `compaction cannot create headroom: the usable budget is ${budget.usableLimit} tokens and the session will not go below ${reading.tokens}; refusing to compact in a circle`;
        store.updateRun(run.id, { status: "FAILED", failureReason: reason });
        store.appendEvent({ runId: run.id, taskId: task.id, type: "RUN_FAILED", summary: reason });
        return { kind: "failed", reason };
      }
    }

    //
    // Everything above this point awaited the backend, and a cancel that
    // landed during one of those awaits has already written the terminal
    // status. Writing RUNNING now would resurrect the Run into a state with
    // no loop driving it, and nothing would ever settle it again.
    //
    const refreshed = store.requireRun(run.id);
    if (TERMINAL_RUN_STATUSES.includes(refreshed.status)) {
      return { kind: "idle", reason: `run is ${refreshed.status.toLowerCase()}` };
    }
    store.updateTask(task.id, {
      status: "RUNNING",
      attemptCount: task.attemptCount + 1,
      startedAtMs: task.startedAtMs ?? store.now(),
    });
    store.updateRun(refreshed.id, { status: "RUNNING", activeTaskId: task.id });

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
        //
        // Count compactions performed, not compactions attempted. A refusal
        // leaves the Run's counter alone, and an agent counting one more than
        // its own Run reads as a bug in whichever number you trust less.
        //
        compactionCount: compactionRecorded ? agent.compactionCount + 1 : agent.compactionCount,
      });
    }

    store.appendEvent({
      runId: refreshed.id,
      taskId: task.id,
      type: compacted ? "AGENT_RESUMED" : "AGENT_STARTED",
      summary: compacted ? `resumed ${task.title} automatically after compaction` : task.title,
    });

    try {
      await gate(() => session.prompt(prompt));
    } catch (error) {
      //
      // A rejected turn is still a settled attempt. Leaving the rows RUNNING
      // under a Run the driver is about to fail would hide the work from both
      // the view and the restart reconciliation.
      //
      const message = error instanceof Error ? error.message : String(error);
      for (const open of store.listAttempts(task.id).filter((entry) => entry.status === "RUNNING")) {
        store.settleAttempt(open.id, { status: "FAILED", outcome: "the turn was rejected", error: message });
      }
      store.updateTask(task.id, { status: "PENDING", blocker: message });
      if (agent) store.updateAgent(agent.id, { status: "INTERRUPTED", currentTaskId: null });
      store.appendEvent({ runId: refreshed.id, taskId: task.id, type: "TASK_FAILED", summary: message });
      throw error;
    }
    return { kind: "resumed", taskId: task.id, compacted };
  };

  //
  // One durable step. Called after every settled turn; it is the only place
  // allowed to move a Run or a Task, and it never asks the owner anything the
  // ledger can answer.
  //
  const advance = async (runId: string, capability: AgenticCapability): Promise<SchedulerStep> => {
    const run = store.requireRun(runId);
    if (TERMINAL_RUN_STATUSES.includes(run.status)) {
      return { kind: "idle", reason: `run is ${run.status.toLowerCase()}` };
    }
    //
    // Adjudicate against the working context that just ran: the agent that
    // owns the active task, not whichever agent happens to be first.
    //
    const settledTask = run.activeTaskId ? store.getTask(run.activeTaskId) : null;
    const agent = agentForTask(run.id, settledTask);
    const session = sessionFor(run, agent);

    const lastError = session.lastError();
    const errors = lastError ? [lastError] : [];
    const finalText = session.lastAssistantText();
    //
    // A step that ends without launching — a replan, for one — leaves the
    // previous turn in place. Reading it again would charge a second attempt
    // for one piece of work, count its tokens twice, and could attribute its
    // evidence to whichever task the revision made current.
    //
    //
    // Keyed by agent: turnId() counts an agent's own turns, so keying by Run
    // made a second agent's first turn look like one already read, and its work
    // was discarded and repeated.
    //
    const turnKey = `${run.id}#${agent?.id ?? "-"}`;
    const turnId = session.turnId();
    const alreadyConsumed = consumedTurns.get(turnKey) === turnId;
    consumedTurns.set(turnKey, turnId);

    if (!alreadyConsumed) {
      const usage = session.lastTurnUsage();
      store.addRunUsage(run.id, usage);
      if (agent) store.addAgentUsage(agent.id, usage);
    }

    //
    // Structured signals are the protocol. A turn that called the reporting
    // tool has already had its evidence validated and committed by the control
    // plane; parsing prose is only the fallback for a turn that reported in
    // words, and it can no longer be the thing a state transition depends on.
    //
    const signals = alreadyConsumed ? [] : store.takePendingSignals(run.id);
    const report = alreadyConsumed
      ? { evidence: [], claimedComplete: false, blockedReason: null, userQuestion: null, errors: [] }
      : signals.length > 0
        ? reportFromSignals(signals, run.activeTaskId)
        : parseTurnReport(finalText);
    const tail: string[] = [];

    let tasks = store.listTasks(run.id);
    // Re-read: the reporting tool wrote to this row during the turn.
    const activeTask = run.activeTaskId ? (store.getTask(run.activeTaskId) ?? null) : null;

    //
    // With no new turn there is nothing to adjudicate. Re-running the
    // judgement on a turn already read would settle its attempt a second time
    // and knock a task that is legitimately WAITING_USER back to PENDING.
    //
    if (activeTask && !alreadyConsumed) {
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
      //
      // A task genuinely waiting on a human is not a dead end. Failing the Run
      // over it would throw away work the owner is one answer away from
      // finishing, and a restart would do it again.
      //
      const waiting = tasks.filter((task) => task.status === "WAITING_USER");
      if (waiting.length > 0) {
        store.updateRun(settledRun.id, { status: "WAITING_USER", activeTaskId: waiting[0]?.id ?? null });
        if (agent) store.updateAgent(agent.id, { status: "WAITING" });
        return {
          kind: "waiting-user",
          taskId: waiting[0]?.id ?? "",
          question: waiting[0]?.blocker ?? "a human decision is required",
        };
      }
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
    return launch(store.requireRun(run.id), nextTask, capability, tail, errors);
  };

  return {
    advance,
    applyReadiness,
    launch,
    budgetFor,
    sessionFor,
  };
}

//
// One turn's signals collapse into the same shape the prose parser produces,
// so everything downstream adjudicates identically whichever way the turn
// chose to report.
//
export function reportFromSignals(
  signals: readonly AgenticTurnSignal[],
  activeTaskId: string | null,
): TurnReport {
  const report: TurnReport = {
    evidence: [],
    claimedComplete: false,
    blockedReason: null,
    userQuestion: null,
    errors: [],
  };
  for (const signal of signals) {
    //
    // A report the model filed against another task settles that task, not
    // whichever one happens to be active. Without this, naming a sibling id
    // could halt the Run on a question the active task never asked.
    //
    if (signal.taskId && activeTaskId && signal.taskId !== activeTaskId) continue;
    if (signal.kind === "evidence" && signal.detail.criterion) {
      report.evidence.push({
        criterionId: signal.detail.criterion,
        evidence: signal.detail.evidence ?? "",
      });
      continue;
    }
    if (signal.kind === "complete") report.claimedComplete = true;
    if (signal.kind === "blocked") report.blockedReason = signal.detail.reason ?? "no reason given";
    if (signal.kind === "needs_user") {
      report.userQuestion = signal.detail.question ?? "a decision is required";
    }
  }
  return report;
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
