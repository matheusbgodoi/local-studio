import type {
  AgenticAgent,
  AgenticRun,
  AgentInferenceActivity,
  AgentInferencePhase,
} from "./contract";

export type InferenceActivityToken = object;

export type InferenceActivityObserver = {
  queued(token: InferenceActivityToken): void;
  generating(token: InferenceActivityToken): void;
  settled(token: InferenceActivityToken): void;
};

type ActiveInference = AgentInferenceActivity & {
  runId: string;
  token: InferenceActivityToken;
};

const TERMINAL_RUNS = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function createInferenceActivityRegistry(now: () => number = Date.now) {
  const active = new Map<string, Map<InferenceActivityToken, ActiveInference>>();

  const setPhase = (
    runId: string,
    agentId: string,
    token: InferenceActivityToken,
    phase: AgentInferencePhase,
  ): void => {
    const streams = active.get(agentId) ?? new Map<InferenceActivityToken, ActiveInference>();
    const current = streams.get(token);
    if (current?.phase === phase) return;
    if (phase === "GENERATING" && !current) return;
    streams.set(token, { runId, agentId, token, phase, sinceMs: now() });
    active.set(agentId, streams);
  };

  return {
    observer(runId: string, agentId: string): InferenceActivityObserver {
      return {
        queued: (token) => setPhase(runId, agentId, token, "QUEUED_FOR_INFERENCE"),
        generating: (token) => setPhase(runId, agentId, token, "GENERATING"),
        settled: (token) => {
          const streams = active.get(agentId);
          streams?.delete(token);
          if (streams?.size === 0) active.delete(agentId);
        },
      };
    },
    snapshot(run: AgenticRun, agents: readonly AgenticAgent[]): AgentInferenceActivity[] {
      if (run.archivedAtMs !== null || TERMINAL_RUNS.has(run.status)) return [];
      return agents.flatMap((agent) => {
        if (agent.status !== "WORKING" && agent.status !== "COMPACTING") return [];
        const activities = [...(active.get(agent.id)?.values() ?? [])].filter(
          (activity) => activity.runId === run.id,
        );
        const generating = activities.filter((activity) => activity.phase === "GENERATING");
        const visible = (generating.length > 0 ? generating : activities).sort(
          (left, right) => left.sinceMs - right.sinceMs,
        )[0];
        if (!visible) return [];
        return [{ agentId: agent.id, phase: visible.phase, sinceMs: visible.sinceMs }];
      });
    },
    clearRun(runId: string): void {
      for (const [agentId, streams] of active) {
        for (const [token, activity] of streams) {
          if (activity.runId === runId) streams.delete(token);
        }
        if (streams.size === 0) active.delete(agentId);
      }
    },
  };
}

export type InferenceActivityRegistry = ReturnType<typeof createInferenceActivityRegistry>;
