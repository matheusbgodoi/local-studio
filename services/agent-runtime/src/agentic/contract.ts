//
// One definition of every durable record, shared by the store, the HTTP
// surface and the owner-facing view. Nothing here carries hidden reasoning:
// decisions, structured summaries, evidence and externally observable state
// only.
//

import type { AgenticTaskStatus } from "./dag";

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

export type AgenticRunStatus = (typeof AGENTIC_RUN_STATUSES)[number];

export const AGENTIC_AGENT_STATUSES = [
  "IDLE",
  "WORKING",
  "COMPACTING",
  "WAITING",
  "INTERRUPTED",
  "FINISHED",
] as const;

export type AgenticAgentStatus = (typeof AGENTIC_AGENT_STATUSES)[number];

export type AgenticAttemptStatus =
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "INTERRUPTED"
  | "ABANDONED";

export type AgenticOperationStatus = "PLANNED" | "STARTED" | "COMMITTED" | "FAILED" | "UNKNOWN";

export type AcceptanceCriterion = {
  id: string;
  description: string;
  kind: "command" | "file" | "artifact" | "review" | "assertion";
  satisfied: boolean;
  evidence: string | null;
};

export type AgenticRun = {
  id: string;
  goal: string;
  status: AgenticRunStatus;
  modelId: string;
  physicalModelId: string;
  behaviorProfile: string | null;
  contextWindow: number;
  usableLimit: number;
  sessionId: string;
  piSessionId: string | null;
  cwd: string;
  planRevision: number;
  activeTaskId: string | null;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCacheTokens: number;
  compactionCount: number;
  latestCheckpointId: string | null;
  resultSummary: string | null;
  failureReason: string | null;
  recoveryState: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgenticTask = {
  id: string;
  runId: string;
  planRevision: number;
  position: number;
  title: string;
  description: string;
  status: AgenticTaskStatus;
  dependencies: string[];
  acceptance: AcceptanceCriterion[];
  attemptCount: number;
  agentId: string | null;
  resultSummary: string | null;
  evidence: string[];
  blocker: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs: number | null;
  settledAtMs: number | null;
};

export type AgenticPlanRevision = {
  runId: string;
  revision: number;
  reason: string;
  taskIds: string[];
  createdAtMs: number;
};

export type AgenticAgent = {
  id: string;
  runId: string;
  name: string;
  role: string;
  status: AgenticAgentStatus;
  modelId: string;
  physicalModelId: string;
  behaviorProfile: string | null;
  currentTaskId: string | null;
  sessionId: string;
  piSessionId: string | null;
  activeContextTokens: number;
  contextLimit: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  compactionCount: number;
  lastHeartbeatMs: number;
  createdAtMs: number;
};

export type AgenticAttempt = {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  attempt: number;
  status: AgenticAttemptStatus;
  outcome: string | null;
  evidence: string[];
  error: string | null;
  startedAtMs: number;
  settledAtMs: number | null;
};

export type AgenticToolOperation = {
  idempotencyKey: string;
  runId: string;
  taskId: string;
  attemptId: string | null;
  action: string;
  requestHash: string;
  status: AgenticOperationStatus;
  sideEffecting: boolean;
  externalState: string | null;
  resultArtifactId: string | null;
  result: unknown;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgenticArtifact = {
  id: string;
  runId: string;
  taskId: string | null;
  kind: string;
  label: string;
  mediaType: string;
  byteSize: number;
  tokenEstimate: number;
  digest: string;
  relativePath: string;
  preview: string;
  provenance: string;
  createdAtMs: number;
};

export type AgenticWorkingSet = {
  goal: string;
  planRevision: number;
  taskId: string | null;
  taskTitle: string | null;
  acceptance: AcceptanceCriterion[];
  dependencyOutputs: { taskId: string; summary: string }[];
  decisions: string[];
  artifactRefs: { id: string; label: string; preview: string }[];
  pendingToolCalls: { idempotencyKey: string; action: string; status: AgenticOperationStatus }[];
  unresolvedErrors: string[];
  recentTail: string[];
  nextAction: string;
};

export type AgenticCheckpoint = {
  id: string;
  runId: string;
  taskId: string | null;
  sequence: number;
  reason: string;
  tokensBefore: number;
  tokensAfter: number;
  targetTokens: number;
  usableLimit: number;
  durationMs: number;
  workingSet: AgenticWorkingSet;
  createdAtMs: number;
};

export type AgenticEvent = {
  id: number;
  runId: string;
  taskId: string | null;
  agentId: string | null;
  type: string;
  summary: string;
  detail: unknown;
  createdAtMs: number;
};

export type AgenticRunSnapshot = {
  run: AgenticRun;
  tasks: AgenticTask[];
  agents: AgenticAgent[];
  events: AgenticEvent[];
  checkpoints: AgenticCheckpoint[];
  artifacts: AgenticArtifact[];
};
