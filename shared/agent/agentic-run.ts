//
// The durable agentic runtime's wire contract, defined once.
//
// The agent-runtime persists these records and the owner-facing view renders
// them, so the shapes live here rather than in either. Nothing in this file
// carries hidden reasoning: decisions, structured summaries, evidence and
// externally observable state only.
//

import { Schema } from "effect";
import { NetworkPolicySchema } from "./network-policy";

export const AGENTIC_RUN_STATUSES = [
  "CREATED",
  "PLANNING",
  "RUNNING",
  "PAUSED",
  "WAITING_USER",
  "COMPLETING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const AGENTIC_TASK_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "BLOCKED",
  "WAITING_USER",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export const AGENTIC_AGENT_STATUSES = [
  "IDLE",
  "WORKING",
  "COMPACTING",
  "WAITING",
  "INTERRUPTED",
  "FINISHED",
] as const;

export const AGENTIC_ATTEMPT_STATUSES = [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "INTERRUPTED",
  "ABANDONED",
] as const;

export const AGENTIC_OPERATION_STATUSES = [
  "PLANNED",
  "STARTED",
  "COMMITTED",
  "FAILED",
  "UNKNOWN",
] as const;

export const AGENT_INFERENCE_PHASES = ["QUEUED_FOR_INFERENCE", "GENERATING"] as const;

export const AgenticRunStatusSchema = Schema.Literals(AGENTIC_RUN_STATUSES);
export const AgenticTaskStatusSchema = Schema.Literals(AGENTIC_TASK_STATUSES);
export const AgenticAgentStatusSchema = Schema.Literals(AGENTIC_AGENT_STATUSES);
export const AgenticAttemptStatusSchema = Schema.Literals(AGENTIC_ATTEMPT_STATUSES);
export const AgenticOperationStatusSchema = Schema.Literals(AGENTIC_OPERATION_STATUSES);
export const AgentInferencePhaseSchema = Schema.Literals(AGENT_INFERENCE_PHASES);

const nullableString = Schema.NullOr(Schema.String);

export const AcceptanceCriterionSchema = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  kind: Schema.Literals(["command", "file", "artifact", "review", "assertion"]),
  satisfied: Schema.Boolean,
  evidence: nullableString,
});

export const AgenticRunSchema = Schema.Struct({
  id: Schema.String,
  goal: Schema.String,
  status: AgenticRunStatusSchema,
  modelId: Schema.String,
  physicalModelId: Schema.String,
  modelDisplayName: nullableString,
  behaviorProfile: nullableString,
  networkPolicy: NetworkPolicySchema,
  contextWindow: Schema.Number,
  usableLimit: Schema.Number,
  sessionId: Schema.String,
  piSessionId: nullableString,
  currentForConversation: Schema.Boolean,
  cwd: Schema.String,
  planRevision: Schema.Number,
  activeTaskId: nullableString,
  cumulativeInputTokens: Schema.Number,
  cumulativeOutputTokens: Schema.Number,
  cumulativeCacheTokens: Schema.Number,
  compactionCount: Schema.Number,
  latestCheckpointId: nullableString,
  resultSummary: nullableString,
  failureReason: nullableString,
  recoveryState: nullableString,
  archivedAtMs: Schema.NullOr(Schema.Number),
  createdAtMs: Schema.Number,
  updatedAtMs: Schema.Number,
});

export const AgenticTaskSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  planRevision: Schema.Number,
  position: Schema.Number,
  title: Schema.String,
  description: Schema.String,
  status: AgenticTaskStatusSchema,
  dependencies: Schema.Array(Schema.String),
  acceptance: Schema.Array(AcceptanceCriterionSchema),
  attemptCount: Schema.Number,
  agentId: nullableString,
  resultSummary: nullableString,
  evidence: Schema.Array(Schema.String),
  blocker: nullableString,
  createdAtMs: Schema.Number,
  updatedAtMs: Schema.Number,
  startedAtMs: Schema.NullOr(Schema.Number),
  settledAtMs: Schema.NullOr(Schema.Number),
});

export const AgenticAgentSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  name: Schema.String,
  role: Schema.String,
  status: AgenticAgentStatusSchema,
  modelId: Schema.String,
  physicalModelId: Schema.String,
  modelDisplayName: nullableString,
  behaviorProfile: nullableString,
  currentTaskId: nullableString,
  sessionId: Schema.String,
  piSessionId: nullableString,
  activeContextTokens: Schema.Number,
  contextLimit: Schema.Number,
  cumulativeInputTokens: Schema.Number,
  cumulativeOutputTokens: Schema.Number,
  compactionCount: Schema.Number,
  lastHeartbeatMs: Schema.Number,
  createdAtMs: Schema.Number,
});

export const AgenticWorkingSetSchema = Schema.Struct({
  goal: Schema.String,
  planRevision: Schema.Number,
  taskId: nullableString,
  taskTitle: nullableString,
  acceptance: Schema.Array(AcceptanceCriterionSchema),
  dependencyOutputs: Schema.Array(Schema.Struct({ taskId: Schema.String, summary: Schema.String })),
  decisions: Schema.Array(Schema.String),
  artifactRefs: Schema.Array(
    Schema.Struct({ id: Schema.String, label: Schema.String, preview: Schema.String }),
  ),
  pendingToolCalls: Schema.Array(
    Schema.Struct({
      idempotencyKey: Schema.String,
      action: Schema.String,
      status: AgenticOperationStatusSchema,
    }),
  ),
  unresolvedErrors: Schema.Array(Schema.String),
  recentTail: Schema.Array(Schema.String),
  nextAction: Schema.String,
});

export const AgenticCheckpointSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  taskId: nullableString,
  sequence: Schema.Number,
  reason: Schema.String,
  tokensBefore: Schema.Number,
  tokensAfter: Schema.Number,
  targetTokens: Schema.Number,
  usableLimit: Schema.Number,
  durationMs: Schema.Number,
  workingSet: AgenticWorkingSetSchema,
  createdAtMs: Schema.Number,
});

export const AgenticArtifactSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  taskId: nullableString,
  kind: Schema.String,
  label: Schema.String,
  mediaType: Schema.String,
  byteSize: Schema.Number,
  tokenEstimate: Schema.Number,
  digest: Schema.String,
  relativePath: Schema.String,
  preview: Schema.String,
  provenance: Schema.String,
  createdAtMs: Schema.Number,
});

export const AgenticEventSchema = Schema.Struct({
  id: Schema.Number,
  runId: Schema.String,
  taskId: nullableString,
  agentId: nullableString,
  type: Schema.String,
  summary: Schema.String,
  detail: Schema.Unknown,
  createdAtMs: Schema.Number,
});

export const AgentInferenceActivitySchema = Schema.Struct({
  agentId: Schema.String,
  phase: AgentInferencePhaseSchema,
  sinceMs: Schema.Number,
});

export const AgenticRunSnapshotSchema = Schema.Struct({
  run: AgenticRunSchema,
  tasks: Schema.Array(AgenticTaskSchema),
  agents: Schema.Array(AgenticAgentSchema),
  events: Schema.Array(AgenticEventSchema),
  checkpoints: Schema.Array(AgenticCheckpointSchema),
  artifacts: Schema.Array(AgenticArtifactSchema),
  inferenceActivity: Schema.Array(AgentInferenceActivitySchema),
});

export const AgenticRunsResponseSchema = Schema.Struct({ runs: Schema.Array(AgenticRunSchema) });
export const AgenticCurrentRunResponseSchema = Schema.Struct({
  run: Schema.NullOr(AgenticRunSchema),
});
export const AgenticRunResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  run: AgenticRunSchema,
});

export type AgenticRunStatus = (typeof AGENTIC_RUN_STATUSES)[number];
export type AgenticTaskStatus = (typeof AGENTIC_TASK_STATUSES)[number];
export type AgenticAgentStatus = (typeof AGENTIC_AGENT_STATUSES)[number];
export type AgenticAttemptStatus = (typeof AGENTIC_ATTEMPT_STATUSES)[number];
export type AgenticOperationStatus = (typeof AGENTIC_OPERATION_STATUSES)[number];
export type AgentInferencePhase = (typeof AGENT_INFERENCE_PHASES)[number];
export type AcceptanceCriterion = typeof AcceptanceCriterionSchema.Type;
export type AgenticRun = typeof AgenticRunSchema.Type;
export type AgenticTask = typeof AgenticTaskSchema.Type;
export type AgenticAgent = typeof AgenticAgentSchema.Type;
export type AgenticWorkingSet = typeof AgenticWorkingSetSchema.Type;
export type AgenticCheckpoint = typeof AgenticCheckpointSchema.Type;
export type AgenticArtifact = typeof AgenticArtifactSchema.Type;
export type AgenticEvent = typeof AgenticEventSchema.Type;
export type AgentInferenceActivity = typeof AgentInferenceActivitySchema.Type;
export type AgenticRunSnapshot = typeof AgenticRunSnapshotSchema.Type;
