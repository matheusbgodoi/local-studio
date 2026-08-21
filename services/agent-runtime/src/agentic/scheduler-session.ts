//
// The one thing the scheduler needs from an inference backend.
//
// Deliberately narrow: a real pi session and a deterministic offline backend
// both satisfy it, so the compaction and resume behaviour can be exercised
// thousands of times without a GPU and then run unchanged against the card.
//

export type AgenticTurnUsage = {
  input: number;
  output: number;
  cache: number;
};

export type AgenticContextReading = {
  tokens: number;
  contextWindow: number;
};

export type AgenticInferenceSession = {
  //
  // A monotonic count of turns this session has actually run. Identifying a
  // turn by its text discarded a genuinely new turn whenever a model repeated
  // itself, which is exactly what a stuck agent does.
  //
  turnId(): number;
  readContext(): Promise<AgenticContextReading>;
  prompt(text: string): Promise<void>;
  compact(instructions: string): Promise<void>;
  lastAssistantText(): string;
  lastTurnUsage(): AgenticTurnUsage;
  lastError(): string | null;
};

export type CompactionOutcome = {
  tokensBefore: number;
  tokensAfter: number;
  effective: boolean;
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
  return {
    tokensBefore: before.tokens,
    tokensAfter: after.tokens,
    effective: after.tokens < before.tokens,
    durationMs: Math.max(0, nowMs() - startedAtMs),
  };
}
