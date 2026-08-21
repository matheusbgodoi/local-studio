//
// The real backend behind the scheduler's narrow session surface.
//
// Per-turn usage does not exist as an event anywhere in the SDK, so it is
// derived the only honest way available: the rollout is the ledger, and a turn
// spent whatever the lifetime totals moved by. Reading it as a delta is also
// what keeps the cumulative counters monotonic across a compaction, which is
// the number the owner was watching fall.
//

import { lastAssistantResult } from "../session-text";
import { emptyUsageTotals, readSessionUsageTotals, type SessionUsageTotals } from "../session-usage";
import { findSessionFile } from "../sessions-store";
import type { RuntimeStartOptions } from "../pi-runtime-helpers";
import type { PiAgentSession } from "../pi-runtime-types";
import type {
  AgenticContextReading,
  AgenticInferenceSession,
  AgenticTurnUsage,
} from "./scheduler-session";

const FALLBACK_CONTEXT_WINDOW = 8_192;

export type PiAgenticSessionInput = {
  session: PiAgentSession;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  fallbackContextWindow: number;
  startOptions?: RuntimeStartOptions;
};

export function createPiAgenticSession(input: PiAgenticSessionInput): AgenticInferenceSession {
  const { session, fallbackContextWindow } = input;
  let previousTotals: SessionUsageTotals = emptyUsageTotals();
  let lastUsage: AgenticTurnUsage = { input: 0, output: 0, cache: 0 };
  let started: Promise<void> | null = null;

  //
  // The scheduler only knows how to ask for a turn, so starting the underlying
  // runtime is this adapter's job. It is idempotent by fingerprint on the pi
  // side, so asking once per session object is enough.
  //
  const ensureStarted = (): Promise<void> => {
    started ??= session.ensureStarted(
      input.modelId,
      input.cwd,
      input.piSessionId,
      input.startOptions,
    );
    return started;
  };

  const rolloutPath = (): string | null => {
    const status = session.status;
    if (!status.piSessionId) return null;
    return findSessionFile(status.cwd, status.piSessionId);
  };

  const captureUsage = async (): Promise<void> => {
    const filepath = rolloutPath();
    if (!filepath) return;
    try {
      const totals = await readSessionUsageTotals(filepath);
      lastUsage = {
        input: Math.max(0, totals.input - previousTotals.input),
        output: Math.max(0, totals.output - previousTotals.output),
        cache: Math.max(0, totals.cacheRead + totals.cacheWrite - (previousTotals.cacheRead + previousTotals.cacheWrite)),
      };
      previousTotals = totals;
    } catch {
      lastUsage = { input: 0, output: 0, cache: 0 };
    }
  };

  return {
    readContext: async (): Promise<AgenticContextReading> => {
      await ensureStarted();
      const usage = session.status.contextUsage;
      return {
        tokens: Math.max(0, Math.floor(usage?.tokens ?? 0)),
        contextWindow: Math.max(
          1,
          Math.floor(usage?.contextWindow ?? fallbackContextWindow ?? FALLBACK_CONTEXT_WINDOW),
        ),
      };
    },
    prompt: async (text: string): Promise<void> => {
      await ensureStarted();
      await session.prompt(text, () => undefined, { source: "rpc" });
      await captureUsage();
    },
    compact: async (instructions: string): Promise<void> => {
      await ensureStarted();
      await session.compact(instructions);
    },
    lastAssistantText: (): string => {
      const status = session.status;
      if (!status.piSessionId) return "";
      return lastAssistantResult(status.cwd, status.piSessionId).text;
    },
    lastTurnUsage: (): AgenticTurnUsage => lastUsage,
    lastError: (): string | null => session.status.lastError,
  };
}
