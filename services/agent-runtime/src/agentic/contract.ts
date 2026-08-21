//
// The durable records, re-exported from the one place they are defined.
//
// The shapes live in `shared/agent/agentic-run.ts` as Effect Schemas because
// the same records cross the wire to the owner-facing view; this module exists
// so the runtime imports them by the name it uses them under, and adds the two
// record types that never leave the process.
//

import type { AgenticOperationStatus } from "../../../../shared/agent/agentic-run";

export type {
  AcceptanceCriterion,
  AgenticAgent,
  AgenticAgentStatus,
  AgenticArtifact,
  AgenticAttemptStatus,
  AgenticCheckpoint,
  AgenticEvent,
  AgenticOperationStatus,
  AgenticRun,
  AgenticRunSnapshot,
  AgenticRunStatus,
  AgenticTask,
  AgenticTaskStatus,
  AgenticWorkingSet,
} from "../../../../shared/agent/agentic-run";

export {
  AGENTIC_AGENT_STATUSES,
  AGENTIC_OPERATION_STATUSES,
  AGENTIC_RUN_STATUSES,
  AGENTIC_TASK_STATUSES,
} from "../../../../shared/agent/agentic-run";

//
// Attempts and tool operations are internal bookkeeping: the view is shown
// tasks, agents and timeline events, never the ledger rows behind them.
//
export type AgenticAttempt = {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  attempt: number;
  status: import("../../../../shared/agent/agentic-run").AgenticAttemptStatus;
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
