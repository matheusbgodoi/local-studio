import type { UiTone } from "@/ui";
import type {
  AgenticAgentStatus,
  AgenticRunStatus,
  AgenticTaskStatus,
} from "@shared/agent/agentic-run";

export function formatTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatElapsed(fromMs: number, toMs: number): string {
  const seconds = Math.max(0, Math.floor((toMs - fromMs) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const RUN_TONES: Record<AgenticRunStatus, UiTone> = {
  CREATED: "default",
  PLANNING: "info",
  RUNNING: "info",
  PAUSED: "warning",
  WAITING_USER: "warning",
  COMPLETING: "info",
  COMPLETED: "good",
  FAILED: "danger",
  CANCELLED: "default",
};

const TASK_TONES: Record<AgenticTaskStatus, UiTone> = {
  PENDING: "default",
  READY: "info",
  RUNNING: "info",
  BLOCKED: "warning",
  WAITING_USER: "warning",
  SUCCEEDED: "good",
  FAILED: "danger",
  CANCELLED: "default",
};

const AGENT_TONES: Record<AgenticAgentStatus, UiTone> = {
  IDLE: "default",
  WORKING: "info",
  COMPACTING: "info",
  WAITING: "warning",
  INTERRUPTED: "warning",
  FINISHED: "good",
};

export const runTone = (status: AgenticRunStatus): UiTone => RUN_TONES[status] ?? "default";
export const taskTone = (status: AgenticTaskStatus): UiTone => TASK_TONES[status] ?? "default";
export const agentTone = (status: AgenticAgentStatus): UiTone => AGENT_TONES[status] ?? "default";

export const humanStatus = (status: string): string =>
  status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (first) => first.toUpperCase());

//
// The timeline shows what the runtime did, never why it thought it. Every
// event type it can render is named here, so an unknown one degrades to its
// own label rather than leaking an internal payload.
//
const EVENT_LABELS: Record<string, string> = {
  RUN_CREATED: "Run created",
  RUN_COMPLETED: "Run completed",
  RUN_FAILED: "Run failed",
  RUN_CANCELLED: "Run cancelled",
  RUN_RECOVERED: "Recovered after restart",
  PLAN_CREATED: "Plan created",
  PLAN_REVISED: "Plan revised",
  REPLAN: "Replanned",
  TASK_STARTED: "Task attempt started",
  TASK_SUCCEEDED: "Task completed",
  TASK_WAITING_USER: "Waiting for you",
  ACCEPTANCE_SATISFIED: "Acceptance criterion met",
  ACCEPTANCE_REJECTED: "Completion rejected",
  AGENT_SPAWNED: "Agent created",
  AGENT_STARTED: "Agent started",
  AGENT_RESUMED: "Resumed automatically",
  COMPACTION_STARTED: "Compaction started",
  COMPACTED: "Context compacted",
  ARTIFACT_EXTERNALISED: "Artifact stored",
  OPERATION_STARTED: "Tool operation started",
};

export const eventLabel = (type: string): string => EVENT_LABELS[type] ?? humanStatus(type);
