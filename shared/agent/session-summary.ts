import type { ExecutionPolicy } from "./execution-policy";

export type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  archived: boolean;
  archivedAt: string | null;
  parentSessionId: string | null;
  subagentName: string | null;
  executionPolicy: ExecutionPolicy | null;
};

export type AggregatedSession = SessionSummary & {
  projectId: string;
  projectName: string;
  projectPath: string;
};
