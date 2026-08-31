import type { AgenticAgent, AgenticRun, AgenticRunSnapshot } from "@shared/agent/agentic-run";

const LIVE_STATUSES = new Set(["WORKING", "COMPACTING", "WAITING"]);

//
// While a run is live the reading belongs to whoever is holding the turn, even
// if that agent has just started and reads zero. Once nothing is live the run
// is being read as history, and the honest answer is the largest context any
// agent was still carrying when it stopped — not whichever row happens to sort
// first, which is how a finished agent made a three-agent run report zero.
//
export function representativeAgent(snapshot: AgenticRunSnapshot): AgenticAgent | null {
  const { agents, run } = snapshot;
  if (agents.length === 0) return null;

  const onActiveTask = run.activeTaskId
    ? agents.find((agent) => agent.currentTaskId === run.activeTaskId)
    : undefined;
  if (onActiveTask && LIVE_STATUSES.has(onActiveTask.status)) return onActiveTask;

  const live = agents
    .filter((agent) => LIVE_STATUSES.has(agent.status))
    .sort((a, b) => b.lastHeartbeatMs - a.lastHeartbeatMs)[0];
  if (live) return live;

  const carrying = agents
    .filter((agent) => agent.activeContextTokens > 0)
    .sort((a, b) => b.activeContextTokens - a.activeContextTokens)[0];
  if (carrying) return carrying;

  return onActiveTask ?? [...agents].sort((a, b) => b.lastHeartbeatMs - a.lastHeartbeatMs)[0];
}

export type RunTokenTotals = {
  input: number;
  output: number;
  cached: number;
  total: number;
};

//
// Cache reads are tokens the run actually sent and actually paid for in time,
// and on this stack they dominate: a run reporting 255K of fresh input had
// moved 4.7M once its cache reads were counted. Leaving them out of the total
// answered a different question than the one being asked.
//
export function runTokenTotals(run: AgenticRun): RunTokenTotals {
  const input = Math.max(0, run.cumulativeInputTokens);
  const output = Math.max(0, run.cumulativeOutputTokens);
  const cached = Math.max(0, run.cumulativeCacheTokens);
  return { input, output, cached, total: input + output + cached };
}
