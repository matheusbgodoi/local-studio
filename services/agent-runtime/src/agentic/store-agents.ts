//
// Logical agents and their attempts.
//
// A logical agent is not a physical model: several agents may be the one
// resident checkpoint through independent sessions, which is why every agent
// row carries the physical model id and behaviour profile it was started with
// and why nothing here ever rewrites them.
//

import { randomUUID } from "node:crypto";

import type { AgenticAgent, AgenticAttempt, AgenticAttemptStatus } from "./contract";
import { toAgent, toAttempt } from "./rows";
import { buildPatch, type AgenticStoreContext } from "./store-context";

export type CreateAgentInput = {
  runId: string;
  name: string;
  role: string;
  modelId: string;
  physicalModelId: string;
  behaviorProfile: string | null;
  sessionId: string;
  piSessionId: string | null;
  contextLimit: number;
};

const AGENT_COLUMNS: Record<string, string> = {
  status: "status",
  currentTaskId: "current_task_id",
  piSessionId: "pi_session_id",
  activeContextTokens: "active_context_tokens",
  contextLimit: "context_limit",
  compactionCount: "compaction_count",
  lastHeartbeatMs: "last_heartbeat_ms",
};

export function createAgentStore(context: AgenticStoreContext) {
  const { all, one, ms, appendEvent } = context;

  const getAgent = (id: string): AgenticAgent | null => {
    const row = one("SELECT * FROM agentic_agents WHERE id = ?", id);
    return row ? toAgent(row) : null;
  };

  const requireAgent = (id: string): AgenticAgent => {
    const agent = getAgent(id);
    if (!agent) throw new Error(`Unknown agentic agent: ${id}`);
    return agent;
  };

  const createAgent = (input: CreateAgentInput): AgenticAgent => {
    const id = `agent_${randomUUID()}`;
    const at = ms();
    context.run(
      `INSERT INTO agentic_agents(id, run_id, name, role, status, model_id, physical_model_id,
         behavior_profile, session_id, pi_session_id, context_limit, last_heartbeat_ms, created_at_ms)
       VALUES (?,?,?,?,'IDLE',?,?,?,?,?,?,?,?)`,
      id,
      input.runId,
      input.name,
      input.role,
      input.modelId,
      input.physicalModelId,
      input.behaviorProfile,
      input.sessionId,
      input.piSessionId,
      input.contextLimit,
      at,
      at,
    );
    appendEvent({
      runId: input.runId,
      agentId: id,
      type: "AGENT_SPAWNED",
      summary: input.name,
      detail: { role: input.role, physicalModelId: input.physicalModelId, behaviorProfile: input.behaviorProfile },
    });
    return requireAgent(id);
  };

  const updateAgent = (id: string, patch: Partial<AgenticAgent>): AgenticAgent => {
    const { assignments, values } = buildPatch(AGENT_COLUMNS, patch as Record<string, unknown>);
    if (assignments.length === 0) return requireAgent(id);
    context.run(`UPDATE agentic_agents SET ${assignments.join(", ")} WHERE id = ?`, ...values, id);
    return requireAgent(id);
  };

  const addAgentUsage = (
    id: string,
    usage: { input?: number; output?: number },
  ): AgenticAgent => {
    context.run(
      `UPDATE agentic_agents SET
         cumulative_input_tokens = cumulative_input_tokens + ?,
         cumulative_output_tokens = cumulative_output_tokens + ?,
         last_heartbeat_ms = ?
       WHERE id = ?`,
      Math.max(0, Math.floor(usage.input ?? 0)),
      Math.max(0, Math.floor(usage.output ?? 0)),
      ms(),
      id,
    );
    return requireAgent(id);
  };

  const startAttempt = (input: {
    runId: string;
    taskId: string;
    agentId: string;
    attempt: number;
  }): AgenticAttempt => {
    const id = `attempt_${randomUUID()}`;
    context.run(
      `INSERT INTO agentic_attempts(id, run_id, task_id, agent_id, attempt, status, started_at_ms)
       VALUES (?,?,?,?,?,'RUNNING',?)`,
      id,
      input.runId,
      input.taskId,
      input.agentId,
      input.attempt,
      ms(),
    );
    appendEvent({
      runId: input.runId,
      taskId: input.taskId,
      agentId: input.agentId,
      type: "TASK_STARTED",
      summary: `attempt ${input.attempt}`,
      detail: { attemptId: id },
    });
    const row = one("SELECT * FROM agentic_attempts WHERE id = ?", id);
    if (!row) throw new Error("Failed to persist agentic attempt");
    return toAttempt(row);
  };

  const settleAttempt = (
    id: string,
    input: {
      status: AgenticAttemptStatus;
      outcome?: string | null;
      evidence?: string[];
      error?: string | null;
    },
  ): AgenticAttempt => {
    context.run(
      `UPDATE agentic_attempts SET status = ?, outcome = ?, evidence_json = ?, error = ?, settled_at_ms = ?
       WHERE id = ?`,
      input.status,
      input.outcome ?? null,
      JSON.stringify(input.evidence ?? []),
      input.error ?? null,
      ms(),
      id,
    );
    const row = one("SELECT * FROM agentic_attempts WHERE id = ?", id);
    if (!row) throw new Error(`Unknown agentic attempt: ${id}`);
    return toAttempt(row);
  };

  return {
    createAgent,
    getAgent,
    requireAgent,
    updateAgent,
    addAgentUsage,
    listAgents: (runId: string): AgenticAgent[] =>
      all("SELECT * FROM agentic_agents WHERE run_id = ? ORDER BY created_at_ms ASC", runId).map(
        toAgent,
      ),
    startAttempt,
    settleAttempt,
    listAttempts: (taskId: string): AgenticAttempt[] =>
      all("SELECT * FROM agentic_attempts WHERE task_id = ? ORDER BY attempt ASC", taskId).map(
        toAttempt,
      ),
    listRunningAttempts: (runId: string): AgenticAttempt[] =>
      all("SELECT * FROM agentic_attempts WHERE run_id = ? AND status = 'RUNNING'", runId).map(
        toAttempt,
      ),
  };
}
