import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  SUBAGENT_RUN_TIMEOUT_MS,
  type SubagentRunInput,
  type SubagentRun,
} from "../../../shared/agent/subagent";
import { resolveDataDir } from "./data-dir";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { lastAssistantText } from "./session-text";
import { sessionSubagentLink, readSubagentRuns, saveSubagentRun } from "./session-metadata-store";

const NICKNAMES = [
  "Euclid",
  "Archimedes",
  "Hypatia",
  "Ptolemy",
  "Leibniz",
  "Lovelace",
  "Boole",
  "Turing",
  "Hopper",
  "Noether",
  "Curie",
  "Gauss",
  "Euler",
  "Ramanujan",
  "Erdos",
  "Franklin",
  "Kepler",
  "Darwin",
  "Fermi",
  "Bohr",
];

const MAX_CONCURRENT_PER_PARENT = 4;
const MAX_RESULT_CHARS = 8000;
const SUBAGENT_SESSION_PREFIX = "subagent:";

export type { SubagentRun } from "../../../shared/agent/subagent";

type SubagentState = {
  byParent: Map<string, SubagentRun[]>;
  childPiSessionIds: Set<string>;
};

function state(): SubagentState {
  return getGlobalSingleton(`subagentRegistry:${resolveDataDir()}`, () => ({
    byParent: new Map<string, SubagentRun[]>(),
    childPiSessionIds: new Set<string>(),
  }));
}

export function listSubagents(parentPiSessionId: string): SubagentRun[] {
  const restored = readSubagentRuns(parentPiSessionId).map(
    (run): SubagentRun =>
      run.status === "running"
        ? {
            ...run,
            status: "interrupted",
            error:
              "Runtime ended before this subagent settled. Inspect its transcript and partial work before starting a replacement; it was not automatically resumed.",
          }
        : run,
  );
  const byId = new Map(restored.map((run) => [run.id, run]));
  for (const run of state().byParent.get(parentPiSessionId) ?? []) {
    if (run.status === "running" || byId.has(run.id)) byId.set(run.id, { ...run });
  }
  return [...byId.values()];
}

function findParentRuntime(parentPiSessionId: string) {
  return piRuntimeManager
    .listSessions()
    .find(({ session }) => session.status.piSessionId === parentPiSessionId);
}

function taskPrompt(name: string, task: string): string {
  return [
    `You are "${name}", a subagent completing one task for a parent agent session.`,
    "Work independently with the tools you have. When finished, end with a clear,",
    "self-contained final report — it is the only thing the parent will see.",
    "",
    task,
  ].join("\n");
}

export function runSubagent(
  input: SubagentRunInput,
  requestSignal?: AbortSignal,
): Promise<{ piSessionId: string | null; result: string }> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(SUBAGENT_RUN_TIMEOUT_MS),
    ...(requestSignal ? [requestSignal] : []),
  ]);
  return Effect.runPromise(
    Effect.tryPromise({
      try: () => executeSubagent(input, signal),
      catch: (error) => error,
    }),
  );
}

async function executeSubagent(
  input: SubagentRunInput,
  signal: AbortSignal,
): Promise<{ piSessionId: string | null; result: string }> {
  signal.throwIfAborted();
  const registry = state();
  const { parentPiSessionId } = input;

  if (
    registry.childPiSessionIds.has(parentPiSessionId) ||
    sessionSubagentLink(parentPiSessionId) !== null
  ) {
    throw new Error("Subagents cannot spawn their own subagents.");
  }
  const parent = findParentRuntime(parentPiSessionId);
  if (!parent) {
    throw new Error("No running session found for this conversation.");
  }
  if (parent.sessionId.startsWith(SUBAGENT_SESSION_PREFIX)) {
    throw new Error("Subagents cannot spawn their own subagents.");
  }
  const running = listSubagents(parentPiSessionId).filter((run) => run.status === "running");
  if (running.length >= MAX_CONCURRENT_PER_PARENT) {
    throw new Error(
      `Too many subagents already running (${running.length}). Wait for one to finish.`,
    );
  }

  const siblingCount = listSubagents(parentPiSessionId).length;
  const run: SubagentRun = {
    id: randomUUID(),
    parentPiSessionId,
    name: input.name.trim() || NICKNAMES[siblingCount % NICKNAMES.length],
    task: input.task,
    piSessionId: null,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    cwd: parent.session.status.cwd,
  };
  const runs = registry.byParent.get(parentPiSessionId) ?? [];
  runs.push(run);
  registry.byParent.set(parentPiSessionId, runs);

  const modelId = input.modelId?.trim() || parent.session.status.modelId;
  const cwd = parent.session.status.cwd;
  const runtimeSessionId = `${SUBAGENT_SESSION_PREFIX}${parentPiSessionId}:${run.id}`;

  const { session } = piRuntimeManager.getSessionForLookup(runtimeSessionId, null);
  const cancel = () => {
    void session.abortStrict().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await saveSubagentRun(run);
    signal.throwIfAborted();
    await session.ensureStarted(modelId, cwd || undefined, null, {
      ...parent.session.getStartOptions(),
      browserSessionId: runtimeSessionId,
    });
    signal.throwIfAborted();
    run.piSessionId = session.status.piSessionId;
    if (!run.piSessionId) throw new Error("Subagent session was not persisted.");
    registry.childPiSessionIds.add(run.piSessionId);
    await saveSubagentRun(run);
    signal.throwIfAborted();
    await session.prompt(taskPrompt(run.name, input.task), () => {}, {
      inferencePriority: "background",
    });
    signal.throwIfAborted();
    const status = session.status;
    const text = status.piSessionId ? lastAssistantText(status.cwd, status.piSessionId) : "";
    if (status.lastError) {
      run.status = "error";
      run.error = status.lastError;
      run.finishedAt = new Date().toISOString();
      throw new Error(`Subagent "${run.name}" failed: ${status.lastError}`);
    }
    run.result = text.slice(0, MAX_RESULT_CHARS) || "(the subagent produced no final text)";
    run.status = "done";
    run.finishedAt = new Date().toISOString();
    return {
      piSessionId: status.piSessionId,
      result: run.result,
    };
  } catch (error) {
    if (run.status === "running") {
      run.status = "error";
      run.error = error instanceof Error ? error.message : "Subagent run failed";
      run.finishedAt = new Date().toISOString();
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      await saveSubagentRun(run);
    } finally {
      try {
        await session.abortStrict();
      } finally {
        await session.stop();
        piRuntimeManager.releaseSession(runtimeSessionId, session);
      }
    }
  }
}
