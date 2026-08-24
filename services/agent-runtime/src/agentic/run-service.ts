//
// Creating and resuming a Run.
//
// The service owns the two entry points a caller has: start a goal, or pick a
// Run back up. Everything after that is the scheduler's business — including,
// especially, the decision to keep working after a compaction.
//

import type { AgenticCapability } from "./capability";
import { networkService } from "../network";
import type { NetworkPolicy } from "../../../../shared/agent/network-policy";
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
  networkPolicy?: NetworkPolicy;
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
      //
      // Captured at birth from the conversation that asked for it, and durable
      // from here on. The owner moving the toggle afterwards starts the NEXT
      // Run somewhere else; it does not quietly re-route this one.
      //
      networkPolicy: input.networkPolicy ?? networkService().sessionPolicy(input.sessionId),
    });
    store.createAgent({
      runId: run.id,
      name: input.agentName ?? "Primary",
      role: input.agentRole ?? "generalist",
      modelId: input.capability.modelId,
      physicalModelId: input.capability.physicalModelId,
      behaviorProfile: input.capability.behaviorProfile,
      sessionId: input.sessionId,
      //
      // Never the caller's: an agent seeded with the chat's pi session id would
      // resolve to the owner's live conversation and work inside it.
      //
      piSessionId: null,
      contextLimit: budget.usableLimit,
    });
    store.recordPlanRevision({ runId: run.id, reason: "initial plan", tasks: input.tasks });
    store.updateRun(run.id, { status: "PLANNING" });
    scheduler.applyReadiness(run.id);
    return store.requireRun(run.id);
  };

  //
  // The one gate every path into the scheduler goes through.
  //
  // A Run that captured `vpn_protected` may not take a turn while the boundary
  // is not carrying traffic — a turn runs tools, and tools reach the network.
  // The answer is a PAUSE, not a failure: losing a tunnel is the same kind of
  // accident as losing the model backend, and the goal has not been decided
  // either way. Nothing here fails a Run, and nothing here lets one out.
  //
  const egressGate = (run: AgenticRun): SchedulerStep | null => {
    if (run.networkPolicy !== "vpn_protected") return null;
    const network = networkService();
    network.setRunPolicy(run.id, run.networkPolicy);
    if (network.mayEgress()) return null;
    if (run.status !== "PAUSED") {
      store.updateRun(run.id, { status: "PAUSED" });
      store.appendEvent({
        runId: run.id,
        type: "RUN_INTERRUPTED",
        summary: `protected network is ${network.currentState().toLowerCase()}; the run is paused until protection is restored`,
      });
    }
    return { kind: "idle", reason: `protected network is ${network.currentState().toLowerCase()}` };
  };

  //
  // A Run that has ended stops asking for protection. Without this the boundary
  // would stay up for the rest of the process's life after the last protected
  // Run finished, quietly routing everyone else's traffic through a tunnel
  // nobody asked for any more.
  //
  const releaseIfFinished = (runId: string): void => {
    const status = store.requireRun(runId).status;
    if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED") {
      networkService().releaseRun(runId);
    }
  };

  const advance = async (runId: string, capability: AgenticCapability): Promise<SchedulerStep> => {
    const step = await scheduler.advance(runId, capability);
    releaseIfFinished(runId);
    return step;
  };

  const startRun = async (input: StartRunInput): Promise<{ run: AgenticRun; step: SchedulerStep }> => {
    const run = createRun(input);
    const blocked = egressGate(run);
    if (blocked) return { run: store.requireRun(run.id), step: blocked };
    const step = await advance(run.id, input.capability);
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
    const blocked = egressGate(run);
    if (blocked) return blocked;
    return advance(runId, options.capabilityFor(run));
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
    //
    // RECOVERY ORDER IS THE SECURITY PROPERTY.
    //
    // Durable state is read, and every protected Run re-registers its policy,
    // BEFORE anything can resume. That is what stops the sequence this feature
    // exists to prevent: app starts, network is open, and only afterwards does
    // it notice a protected Run was in flight. Registering the policy engages
    // the boundary, and the boundary is up before the first turn is possible.
    //
    // Reconciliation itself leaves every unfinished Run PAUSED, so resuming is
    // an explicit act that has to pass egressGate() on the way through.
    //
    recover: (): RunRecovery[] => {
      const recovered = reconcileAllRuns(store);
      const network = networkService();
      for (const run of store.listUnfinishedRuns()) {
        if (run.networkPolicy === "vpn_protected") network.setRunPolicy(run.id, run.networkPolicy);
      }
      return recovered;
    },
    onTurnSettled: (runId: string): Promise<SchedulerStep> => {
      const run = store.requireRun(runId);
      return advance(runId, options.capabilityFor(run));
    },
  };
}

export type AgenticRunService = ReturnType<typeof createAgenticRunService>;
