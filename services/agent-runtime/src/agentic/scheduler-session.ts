export type AgenticTurnUsage = {
  input: number;
  output: number;
  cache: number;
};

export type AgenticContextReading = {
  tokens: number;
  measured?: boolean;
  contextWindow: number;
};

export type AgenticInferenceSession = {
  turnId(): number;
  readContext(): Promise<AgenticContextReading>;
  prompt(text: string): Promise<void>;
  abort?(): Promise<void>;
  compact(instructions: string): Promise<void>;
  lastAssistantText(): string;
  lastTurnUsage(): AgenticTurnUsage;
  lastError(): string | null;
};

export type CompactionOutcome = {
  tokensBefore: number;
  tokensAfter: number;
  beforeMeasured: boolean;
  afterMeasured: boolean;
  effective: boolean | null;
  durationMs: number;
};

export async function runCompaction(
  session: AgenticInferenceSession,
  instructions: string,
  startedAtMs: number,
  nowMs: () => number,
): Promise<CompactionOutcome> {
  const before = await session.readContext();
  await session.compact(instructions);
  const after = await session.readContext();
  const beforeMeasured = before.measured ?? before.tokens > 0;
  const afterMeasured = after.measured ?? after.tokens > 0;
  return {
    tokensBefore: before.tokens,
    tokensAfter: after.tokens,
    beforeMeasured,
    afterMeasured,
    effective: beforeMeasured && afterMeasured ? after.tokens < before.tokens : null,
    durationMs: Math.max(0, nowMs() - startedAtMs),
  };
}

export function resolveContextReading(
  reportedTokens: number | null | undefined,
  contextWindow: number,
  estimate: () => number | null,
): AgenticContextReading {
  if (typeof reportedTokens === "number" && Number.isFinite(reportedTokens) && reportedTokens > 0) {
    return { tokens: Math.ceil(reportedTokens), contextWindow, measured: true };
  }
  const estimatedTokens = estimate();
  if (
    typeof estimatedTokens !== "number" ||
    !Number.isFinite(estimatedTokens) ||
    estimatedTokens <= 0
  ) {
    throw new Error(
      "Active context usage is unavailable and its retained messages, system prompt and tool schemas could not be estimated. Reload the session before resuming the run.",
    );
  }
  return { tokens: Math.ceil(estimatedTokens), contextWindow, measured: false };
}
