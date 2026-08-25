//
// Row decoding for the durable store. SQLite hands back `unknown`; every
// record crosses this boundary exactly once so no caller has to guess.
//

import type {
  AcceptanceCriterion,
  AgenticAgent,
  AgenticAgentStatus,
  AgenticArtifact,
  AgenticAttempt,
  AgenticAttemptStatus,
  AgenticCheckpoint,
  AgenticEvent,
  AgenticOperationStatus,
  AgenticRun,
  AgenticRunStatus,
  AgenticTask,
  AgenticTaskStatus,
  AgenticToolOperation,
  AgenticWorkingSet,
} from "./contract";
import {
  DEFAULT_NETWORK_POLICY,
  parseNetworkPolicy,
  type NetworkPolicy,
} from "../../../../shared/agent/network-policy";

export type Row = Record<string, unknown>;

export const text = (value: unknown): string => (typeof value === "string" ? value : "");

export const nullableText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const int = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
};

export const nullableInt = (value: unknown): number | null =>
  value === null || value === undefined ? null : int(value);

export const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const EMPTY_WORKING_SET: AgenticWorkingSet = {
  goal: "",
  planRevision: 0,
  taskId: null,
  taskTitle: null,
  acceptance: [],
  dependencyOutputs: [],
  decisions: [],
  artifactRefs: [],
  pendingToolCalls: [],
  unresolvedErrors: [],
  recentTail: [],
  nextAction: "",
};

export const toRun = (row: Row): AgenticRun => ({
  id: text(row.id),
  goal: text(row.goal),
  status: text(row.status) as AgenticRunStatus,
  modelId: text(row.model_id),
  physicalModelId: text(row.physical_model_id),
  behaviorProfile: nullableText(row.behavior_profile),
  networkPolicy: (parseNetworkPolicy(row.network_policy) ?? DEFAULT_NETWORK_POLICY) as NetworkPolicy,
  contextWindow: int(row.context_window),
  usableLimit: int(row.usable_limit),
  sessionId: text(row.session_id),
  piSessionId: nullableText(row.pi_session_id),
  cwd: text(row.cwd),
  planRevision: int(row.plan_revision),
  activeTaskId: nullableText(row.active_task_id),
  cumulativeInputTokens: int(row.cumulative_input_tokens),
  cumulativeOutputTokens: int(row.cumulative_output_tokens),
  cumulativeCacheTokens: int(row.cumulative_cache_tokens),
  compactionCount: int(row.compaction_count),
  latestCheckpointId: nullableText(row.latest_checkpoint_id),
  resultSummary: nullableText(row.result_summary),
  failureReason: nullableText(row.failure_reason),
  recoveryState: nullableText(row.recovery_state),
  archivedAtMs: row.archived_at_ms === null || row.archived_at_ms === undefined ? null : int(row.archived_at_ms),
  createdAtMs: int(row.created_at_ms),
  updatedAtMs: int(row.updated_at_ms),
});

export const toTask = (row: Row): AgenticTask => ({
  id: text(row.id),
  runId: text(row.run_id),
  planRevision: int(row.plan_revision),
  position: int(row.position),
  title: text(row.title),
  description: text(row.description),
  status: text(row.status) as AgenticTaskStatus,
  dependencies: parseJson<string[]>(row.dependencies_json, []),
  acceptance: parseJson<AcceptanceCriterion[]>(row.acceptance_json, []),
  attemptCount: int(row.attempt_count),
  agentId: nullableText(row.agent_id),
  resultSummary: nullableText(row.result_summary),
  evidence: parseJson<string[]>(row.evidence_json, []),
  blocker: nullableText(row.blocker),
  createdAtMs: int(row.created_at_ms),
  updatedAtMs: int(row.updated_at_ms),
  startedAtMs: nullableInt(row.started_at_ms),
  settledAtMs: nullableInt(row.settled_at_ms),
});

export const toAgent = (row: Row): AgenticAgent => ({
  id: text(row.id),
  runId: text(row.run_id),
  name: text(row.name),
  role: text(row.role),
  status: text(row.status) as AgenticAgentStatus,
  modelId: text(row.model_id),
  physicalModelId: text(row.physical_model_id),
  behaviorProfile: nullableText(row.behavior_profile),
  currentTaskId: nullableText(row.current_task_id),
  sessionId: text(row.session_id),
  piSessionId: nullableText(row.pi_session_id),
  activeContextTokens: int(row.active_context_tokens),
  contextLimit: int(row.context_limit),
  cumulativeInputTokens: int(row.cumulative_input_tokens),
  cumulativeOutputTokens: int(row.cumulative_output_tokens),
  compactionCount: int(row.compaction_count),
  lastHeartbeatMs: int(row.last_heartbeat_ms),
  createdAtMs: int(row.created_at_ms),
});

export const toAttempt = (row: Row): AgenticAttempt => ({
  id: text(row.id),
  runId: text(row.run_id),
  taskId: text(row.task_id),
  agentId: text(row.agent_id),
  attempt: int(row.attempt),
  status: text(row.status) as AgenticAttemptStatus,
  outcome: nullableText(row.outcome),
  evidence: parseJson<string[]>(row.evidence_json, []),
  error: nullableText(row.error),
  startedAtMs: int(row.started_at_ms),
  settledAtMs: nullableInt(row.settled_at_ms),
});

export const toOperation = (row: Row): AgenticToolOperation => ({
  idempotencyKey: text(row.idempotency_key),
  runId: text(row.run_id),
  taskId: text(row.task_id),
  attemptId: nullableText(row.attempt_id),
  action: text(row.action),
  requestHash: text(row.request_hash),
  status: text(row.status) as AgenticOperationStatus,
  sideEffecting: int(row.side_effecting) === 1,
  externalState: nullableText(row.external_state),
  resultArtifactId: nullableText(row.result_artifact_id),
  result: parseJson<unknown>(row.result_json, null),
  createdAtMs: int(row.created_at_ms),
  updatedAtMs: int(row.updated_at_ms),
});

export const toArtifact = (row: Row): AgenticArtifact => ({
  id: text(row.id),
  runId: text(row.run_id),
  taskId: nullableText(row.task_id),
  kind: text(row.kind),
  label: text(row.label),
  mediaType: text(row.media_type),
  byteSize: int(row.byte_size),
  tokenEstimate: int(row.token_estimate),
  digest: text(row.digest),
  relativePath: text(row.relative_path),
  preview: text(row.preview),
  provenance: text(row.provenance),
  createdAtMs: int(row.created_at_ms),
});

export const toCheckpoint = (row: Row): AgenticCheckpoint => ({
  id: text(row.id),
  runId: text(row.run_id),
  taskId: nullableText(row.task_id),
  sequence: int(row.sequence),
  reason: text(row.reason),
  tokensBefore: int(row.tokens_before),
  tokensAfter: int(row.tokens_after),
  targetTokens: int(row.target_tokens),
  usableLimit: int(row.usable_limit),
  durationMs: int(row.duration_ms),
  workingSet: parseJson<AgenticWorkingSet>(row.working_set_json, EMPTY_WORKING_SET),
  createdAtMs: int(row.created_at_ms),
});

export const toEvent = (row: Row): AgenticEvent => ({
  id: int(row.id),
  runId: text(row.run_id),
  taskId: nullableText(row.task_id),
  agentId: nullableText(row.agent_id),
  type: text(row.type),
  summary: text(row.summary),
  detail: parseJson<unknown>(row.detail_json, null),
  createdAtMs: int(row.created_at_ms),
});
