//
// A deterministic offline stand-in for an inference backend.
//
// It satisfies exactly the AgenticInferenceSession surface the scheduler uses,
// with a configurable context window, predictable token accounting, scripted
// turn outcomes and controllable errors. That is what makes it possible to
// force a dozen compactions in a millisecond instead of filling 176128 real
// tokens to observe the third one.
//
// Relative on purpose: bun resolves no `@/` alias from this package.
//

import type {
  AgenticContextReading,
  AgenticInferenceSession,
  AgenticTurnUsage,
} from "../../src/agentic/scheduler-session";
import type { AgentModel } from "../../../../shared/agent/models";

export type ScriptedTurn = {
  text: string;
  outputTokens?: number;
  contextGrowth?: number;
  error?: string | null;
};

export type FakeBackendOptions = {
  contextWindow: number;
  baseTokens?: number;
  turns?: ScriptedTurn[];
  fallback?: (turnIndex: number) => ScriptedTurn;
  compactionFloorTokens?: number;
  ineffectiveCompaction?: boolean;
  compactionError?: string;
  promptError?: string;
  startIndex?: number;
};

export type FakeBackend = {
  session: AgenticInferenceSession;
  promptsSent: string[];
  compactions: { instructions: string; before: number; after: number }[];
  turnIndex: () => number;
  activeTokens: () => number;
  setContextWindow: (window: number) => void;
};

const estimate = (value: string): number => Math.ceil(value.length / 4);

export function createFakeBackend(options: FakeBackendOptions): FakeBackend {
  const baseTokens = options.baseTokens ?? 400;
  const compactionFloor = options.compactionFloorTokens ?? baseTokens;
  let contextWindow = options.contextWindow;
  let activeTokens = baseTokens;
  let index = options.startIndex ?? 0;
  let lastText = "";
  let lastError: string | null = null;
  let lastUsage: AgenticTurnUsage = { input: 0, output: 0, cache: 0 };

  const promptsSent: string[] = [];
  const compactions: { instructions: string; before: number; after: number }[] = [];

  const nextTurn = (): ScriptedTurn => {
    const scripted = options.turns?.[index];
    if (scripted) return scripted;
    if (options.fallback) return options.fallback(index);
    return { text: "working on it" };
  };

  const session: AgenticInferenceSession = {
    turnId: () => index,
    readContext: async (): Promise<AgenticContextReading> => ({
      tokens: activeTokens,
      contextWindow,
    }),
    prompt: async (text: string): Promise<void> => {
      if (options.promptError) throw new Error(options.promptError);
      const turn = nextTurn();
      index += 1;
      promptsSent.push(text);
      const inputTokens = estimate(text);
      const outputTokens = turn.outputTokens ?? 120;
      activeTokens += inputTokens + outputTokens + (turn.contextGrowth ?? 0);
      lastText = turn.text;
      lastError = turn.error ?? null;
      lastUsage = { input: inputTokens, output: outputTokens, cache: 0 };
    },
    compact: async (instructions: string): Promise<void> => {
      if (options.compactionError) throw new Error(options.compactionError);
      const before = activeTokens;
      const after = options.ineffectiveCompaction
        ? before
        : Math.max(compactionFloor, baseTokens + estimate(instructions));
      activeTokens = after;
      compactions.push({ instructions, before, after });
    },
    lastAssistantText: () => lastText,
    lastTurnUsage: () => lastUsage,
    lastError: () => lastError,
  };

  return {
    session,
    promptsSent,
    compactions,
    turnIndex: () => index,
    activeTokens: () => activeTokens,
    setContextWindow: (window: number) => {
      contextWindow = window;
    },
  };
}

//
// A wire row shaped exactly like the one the gateway publishes, so tests read
// capabilities through the same contract production does.
//
export function fakeAgentModel(overrides: Partial<AgentModel> = {}): AgentModel {
  return {
    id: "fake-model",
    name: "Fake Model",
    provider: "local-studio",
    physicalModelId: "fake-model",
    contextWindow: 8000,
    maxTokens: 2000,
    reasoning: false,
    vision: false,
    tools: true,
    active: true,
    ...overrides,
  } as AgentModel;
}
