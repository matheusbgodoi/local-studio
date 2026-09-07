import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentImageInput } from "../../../shared/agent/agent-image-input";
import type { AgentQueueAction } from "../../../shared/agent/agent-turn";
import type { RuntimeStartOptions } from "./pi-runtime-helpers";
import type { InferenceActivityObserver } from "./agentic/inference-activity";
import type { NetworkPolicy } from "../../../shared/agent/network-policy";

type PiEvent = (Record<string, unknown> & { type?: string }) | AgentSessionEvent;

export type { AgentSessionEvent };

export type LoggedPiEvent = {
  seq: number;
  event: PiEvent;
  timestamp: string;
};

export type PiPromptOptions = {
  streamingBehavior?: "steer" | "followUp";
  images?: AgentImageInput[];
  expandPromptTemplates?: boolean;
  source?: "interactive" | "rpc" | "extension";
  inferencePriority?: "interactive" | "background";
  preflightResult?: (success: boolean) => void;
  restartOnContinuationError?: boolean;
  inferenceObserver?: InferenceActivityObserver;
};

export type ConnectorSelectionResult = {
  active: string[];
  pending: string[];
  errors: Record<string, string>;
};

export type PiDurablePromptMarker = {
  dispatchId: string;
  messageId: string;
  contentHash: string;
};

export type PiDurablePromptBoundary = {
  dispatchId: string;
  markerEntryId: string;
  userEntryId: string;
  piSessionId: string;
  sessionFile: string;
  cwd: string;
  modelId: string;
  behaviorProfile: string | null;
  networkPolicy: NetworkPolicy;
  acceptedAt: string;
};

export type { RuntimeContextUsage as PiContextUsage } from "../../../shared/agent/context-usage";

export type PiAgentStatus = {
  running: boolean;
  active: boolean;
  modelId: string;
  behaviorProfile: string | null;
  networkPolicy: NetworkPolicy;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  contextUsage: import("../../../shared/agent/context-usage").RuntimeContextUsage | null;
};

export interface PiAgentSession {
  getStartOptions(): RuntimeStartOptions;
  ensureStarted(
    modelId: string,
    cwd?: string,
    piSessionId?: string | null,
    options?: RuntimeStartOptions,
  ): Promise<void>;
  prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options?: PiPromptOptions,
  ): Promise<void>;
  promptDurably(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    marker: PiDurablePromptMarker,
    options?: PiPromptOptions,
  ): Promise<PiDurablePromptBoundary>;
  steer(message: string, images?: AgentImageInput[]): Promise<void>;
  mutateQueuedFollowUp(
    message: string,
    action: AgentQueueAction,
    replacement?: string,
    images?: AgentImageInput[],
  ): Promise<void>;
  followUp(message: string, images?: AgentImageInput[]): Promise<void>;
  abort(): Promise<{ steering: string[]; followUp: string[] }>;
  abortStrict(): Promise<void>;
  compact(
    customInstructions?: string,
    inferenceObserver?: InferenceActivityObserver,
  ): Promise<unknown>;
  contextBudget(): import("./context-budget").ContextBudgetReport | null;
  setConnectorSelection(connectorIds: string[]): Promise<ConnectorSelectionResult>;
  getConnectorSelection(): string[];
  getActiveToolNames(): string[];
  stop(): Promise<void>;
  readonly status: PiAgentStatus;
  getEventsAfter(seq: number): LoggedPiEvent[];
  onLoggedEvent(listener: (event: LoggedPiEvent) => void): () => void;
  adoptPiSessionId(piSessionId: string | null | undefined): void;
  respondExtensionUi(
    requestId: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): boolean;
}

export type { RuntimeStartOptions };
