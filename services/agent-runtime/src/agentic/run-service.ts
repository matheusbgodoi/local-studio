//
// Creating and resuming a Run.
//
// The service owns the two entry points a caller has: start a goal, or pick a
// Run back up. Everything after that is the scheduler's business — including,
// especially, the decision to keep working after a compaction.
//

import type { AgenticCapability } from "./capability";
import { computeContextBudget, type ContextBudgetPolicy } from "./context-budget";
import type { AgenticAgent, AgenticRun, AgenticRunSnapshot } from "./contract";
import { validatePlan } from "./dag";
import { reconcileAllRuns, type RunRecovery } from "./recovery";
import { createAgenticScheduler, seedNodes, type InferenceGate, type SchedulerStep } from "./scheduler";
import type { AgenticInferenceSession } from "./scheduler-session";
import type { AgenticStore, TaskSeed } from "./store";

export type StartRunInput = {
  goal: string;
  capability: AgenticCapability;
  sessionId: string;
  piSessionId: string | null;
  cwd: string;
  tasks: TaskSeed[];
  agentName?: string;
  agentRole?: string;
};

export type AgenticRunServiceOptions = {
  store: AgenticStore;
  session: (run: AgenticRun, agent: AgenticAgent | null) => AgenticInferenceSession;
  capabilityFor: (run: AgenticRun) => AgenticCapability;
  budgetPolicy?: ContextBudgetPolicy;
  inferenceGate?: InferenceGate;
};

export function createAgenticRunService(options: AgenticRunServiceOptions) {
  const store = options.store;
  const scheduler = createAgenticScheduler({
    store,
    session: options.session,
    budgetPolicy: options.budgetPolicy,
    ...(options.inferenceGate ? { inferenceGate: options.inferenceGate } : {}),
  });

  //
  // Creating a Run is synchronous and durable. No inference is launched here:
  // the scheduler loop owns every turn, so a caller gets its Run id back
  // immediately and one local inference slot is never double-booked.
  //
  const createRun = (input: StartRunInput): AgenticRun => {
    const validation = validatePlan(seedNodes(input.tasks));
    if (!validation.ok) {
      throw new Error(`Invalid plan: ${validation.reason}`);
    }
    const budget = computeContextBudget(input.capability, options.budgetPolicy);
    const run = store.createRun({
      goal: input.goal,
      modelId: input.capability.modelId,
      physicalModelId: input.capability.physicalModelId,
      behaviorProfile: input.capability.behaviorProfile,
      contextWindow: input.capability.contextWindow,
      usableLimit: budget.usableLimit,
      sessionId: input.sessionId,
      piSessionId: input.piSessionId,
      cwd: input.cwd,
    });
    store.createAgent({
      runId: run.id,
      name: input.agentName ?? "Primary",
      role: input.agentRole ?? "generalist",
      modelId: input.capability.modelId,
      physicalModelId: input.capability.physicalModelId,
      behaviorProfile: input.capability.behaviorProfile,
      sessionId: input.sessionId,
      piSessionId: input.piSessionId,
      contextLimit: budget.usableLimit,
    });
    store.recordPlanRevision({ runId: run.id, reason: "initial plan", tasks: input.tasks });
    store.updateRun(run.id, { status: "PLANNING" });
    scheduler.applyReadiness(run.id);
    return store.requireRun(run.id);
  };

  const startRun = async (input: StartRunInput): Promise<{ run: AgenticRun; step: SchedulerStep }> => {
    const run = createRun(input);
    const step = await scheduler.advance(run.id, input.capability);
    return { run: store.requireRun(run.id), step };
  };

  //
  // Resume is the same call the scheduler makes to itself after a compaction:
  // there is no second, "manual" path that behaves differently.
  //
  const resumeRun = async (runId: string): Promise<SchedulerStep> => {
    const run = store.requireRun(runId);
    if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") {
      return { kind: "idle", reason: `run is ${run.status.toLowerCase()}` };
    }
    return scheduler.advance(runId, options.capabilityFor(run));
  };

  const snapshot = (runId: string): AgenticRunSnapshot => {
    const run = store.requireRun(runId);
    return {
      run,
      tasks: store.listTasks(runId),
      agents: store.listAgents(runId),
      events: store.listEvents(runId),
      checkpoints: store.listCheckpoints(runId),
      artifacts: store.listArtifacts(runId),
    };
  };

  return {
    scheduler,
    createRun,
    startRun,
    resumeRun,
    snapshot,
    recover: (): RunRecovery[] => reconcileAllRuns(store),
    onTurnSettled: (runId: string): Promise<SchedulerStep> => {
      const run = store.requireRun(runId);
      return scheduler.advance(runId, options.capabilityFor(run));
    },
  };
}

export type AgenticRunService = ReturnType<typeof createAgenticRunService>;
