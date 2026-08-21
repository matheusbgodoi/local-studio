//
// The process-wide durable runtime.
//
// It owns one store, reconciles unfinished Runs once at startup, resolves the
// capability contract from the live catalogue, and drives each Run in a loop
// whose every step is a persisted transition. Because `prompt()` resolves when
// the turn is done, the loop IS the turn sequencing — one local inference at a
// time, with no event listener able to advance a Run twice.
//

import { resolveAgenticCapability, withRuntimeContextWindow, type AgenticCapability } from "./capability";
import { DEFAULT_CONTEXT_BUDGET_POLICY, type ContextBudgetPolicy } from "./context-budget";
import type { AgenticRun, AgenticRunSnapshot } from "./contract";
import { createPiAgenticSession } from "./pi-session-adapter";
import { createAgenticRunService, type StartRunInput } from "./run-service";
import { createAgenticStore, type AgenticStore } from "./store";
import { resolveDataDir } from "../data-dir";
import { getGlobalSingleton } from "../instances";
import { piRuntimeManager } from "../pi-runtime";
import { refreshPiModels } from "../pi-runtime-models";
import type { AgentModel } from "../../../../shared/agent/models";

export const AGENTIC_USABLE_CONTEXT_ENV = "LOCAL_STUDIO_AGENTIC_USABLE_CONTEXT";

//
// A narrowing override for long end-to-end runs against a real card: it makes
// the SCHEDULER behave as though its usable context were smaller, and touches
// neither the model nor the served window. Unset in production, and it can
// only ever narrow — computeContextBudget ignores a wider value.
//
export function usableContextOverride(env = process.env): number | null {
  const raw = env[AGENTIC_USABLE_CONTEXT_ENV]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function agenticBudgetPolicy(env = process.env): ContextBudgetPolicy {
  return { ...DEFAULT_CONTEXT_BUDGET_POLICY, usableContextOverride: usableContextOverride(env) };
}

type RuntimeState = {
  store: AgenticStore;
  service: ReturnType<typeof createAgenticRunService>;
  loops: Map<string, Promise<void>>;
  cancelled: Set<string>;
  capabilities: Map<string, AgenticCapability>;
};

const piSessionFor = (run: AgenticRun) =>
  piRuntimeManager.getSessionForLookup(run.sessionId, run.piSessionId).session;

const sessionFor = (run: AgenticRun) =>
  createPiAgenticSession({
    session: piSessionFor(run),
    modelId: run.modelId,
    cwd: run.cwd,
    piSessionId: run.piSessionId,
    fallbackContextWindow: run.contextWindow,
  });

function createRuntime(): RuntimeState {
  const store = createAgenticStore(resolveDataDir());
  const capabilities = new Map<string, AgenticCapability>();

  const capabilityFor = (run: AgenticRun): AgenticCapability => {
    const cached = capabilities.get(run.id);
    if (cached) return cached;
    const fallback: AgenticCapability = {
      modelId: run.modelId,
      physicalModelId: run.physicalModelId,
      behaviorProfile: run.behaviorProfile,
      behaviorProfileLabel: null,
      contextWindow: run.contextWindow,
      maxOutputTokens: Math.min(run.contextWindow, 32_768),
      reasoning: false,
      tools: true,
      vision: false,
      contextWindowDeclared: true,
    };
    capabilities.set(run.id, fallback);
    return fallback;
  };

  const service = createAgenticRunService({
    store,
    session: sessionFor,
    capabilityFor,
    budgetPolicy: agenticBudgetPolicy(),
  });

  service.recover();

  return { store, service, loops: new Map(), cancelled: new Set(), capabilities };
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "WAITING_USER"]);
const MAX_LOOP_STEPS = 10_000;

export function agenticRuntime() {
  const state = getGlobalSingleton("agenticRuntime", createRuntime);

  //
  // The capability is re-resolved from the live catalogue on every start and
  // resume, so a backend restarted with a different -c moves the budget of a
  // Run already in flight without a redeploy.
  //
  const resolveCapability = async (modelId: string): Promise<AgenticCapability> => {
    const { models } = await refreshPiModels();
    const model = models.find((entry: AgentModel) => entry.id === modelId);
    if (!model) throw new Error(`Unknown model for an agentic run: ${modelId}`);
    return resolveAgenticCapability(model);
  };

  const drive = async (runId: string): Promise<void> => {
    for (let step = 0; step < MAX_LOOP_STEPS; step += 1) {
      if (state.cancelled.has(runId)) return;
      const run = state.store.requireRun(runId);
      if (TERMINAL.has(run.status)) return;
      const capability = state.capabilities.get(runId) ?? (await resolveCapability(run.modelId));
      const observed = withRuntimeContextWindow(
        capability,
        (await state.service.scheduler.sessionFor(run).readContext()).contextWindow,
      );
      state.capabilities.set(runId, observed);
      if (observed.contextWindow !== run.contextWindow) {
        state.store.updateRun(runId, { contextWindow: observed.contextWindow });
      }
      //
      // The pi session id only exists once the runtime has started. Adopting
      // it is what lets a restart find the same rollout instead of opening a
      // second conversation for a Run already in flight.
      //
      const adopted = piSessionFor(run).status.piSessionId;
      if (adopted && adopted !== run.piSessionId) {
        state.store.updateRun(runId, { piSessionId: adopted });
        for (const agent of state.store.listAgents(runId)) {
          state.store.updateAgent(agent.id, { piSessionId: adopted });
        }
      }
      await state.service.scheduler.advance(runId, observed);
    }
  };

  const startLoop = (runId: string): void => {
    if (state.loops.has(runId)) return;
    state.cancelled.delete(runId);
    const loop = drive(runId)
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        state.store.updateRun(runId, { status: "FAILED", failureReason: reason });
        state.store.appendEvent({ runId, type: "RUN_FAILED", summary: reason });
      })
      .finally(() => {
        state.loops.delete(runId);
      });
    state.loops.set(runId, loop);
  };

  return {
    store: state.store,
    service: state.service,
    resolveCapability,
    listRuns: (): AgenticRun[] => state.store.listRuns(),
    snapshot: (runId: string): AgenticRunSnapshot => state.service.snapshot(runId),
    startRun: async (input: Omit<StartRunInput, "capability"> & { modelId: string }) => {
      const capability = await resolveCapability(input.modelId);
      const run = state.service.createRun({ ...input, capability });
      state.capabilities.set(run.id, capability);
      startLoop(run.id);
      return run;
    },
    resumeRun: async (runId: string): Promise<AgenticRun> => {
      const run = state.store.requireRun(runId);
      if (TERMINAL.has(run.status) && run.status !== "WAITING_USER") return run;
      state.store.updateRun(runId, { status: "RUNNING" });
      startLoop(runId);
      return state.store.requireRun(runId);
    },
    cancelRun: (runId: string): AgenticRun => {
      state.cancelled.add(runId);
      state.store.updateRun(runId, { status: "CANCELLED", activeTaskId: null });
      state.store.appendEvent({ runId, type: "RUN_CANCELLED", summary: "cancelled by the owner" });
      return state.store.requireRun(runId);
    },
    readArtifact: (artifactId: string, offset: number, length: number): string | null =>
      state.store.readArtifactSlice(artifactId, offset, length),
  };
}
