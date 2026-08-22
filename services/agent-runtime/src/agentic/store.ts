//
// The durable Run store: one SQLite connection, three sub-stores composed into
// a single object so the scheduler holds one handle and every write lands in
// the same file and the same transactional discipline.
//

import path from "node:path";

import { createAgentStore } from "./store-agents";
import { createStoreContext } from "./store-context";
import { createOperationStore } from "./store-operations";
import { createRunStore } from "./store-runs";
import { createSignalStore } from "./store-signals";
import { openAgenticDatabase } from "./schema";

export const AGENTIC_ARTIFACTS_DIRNAME = "agentic-artifacts";

export function createAgenticStore(dataDir: string, now: () => Date = () => new Date()) {
  const { database, filepath } = openAgenticDatabase(dataDir);
  const context = createStoreContext(database, now);
  const artifactsRoot =
    dataDir === ":memory:"
      ? path.join(process.cwd(), ".agentic-artifacts")
      : path.join(dataDir, AGENTIC_ARTIFACTS_DIRNAME);

  return {
    filepath,
    artifactsRoot,
    now: context.ms,
    appendEvent: context.appendEvent,
    close: (): void => database.close(),
    tableNames: (): string[] =>
      (context.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name") as {
        name?: unknown;
      }[]).map((row) => String(row.name ?? "")),
    ...createRunStore(context),
    ...createAgentStore(context),
    ...createOperationStore(context, artifactsRoot),
    ...createSignalStore(context),
  };
}

export type AgenticStore = ReturnType<typeof createAgenticStore>;
export type { CreateRunInput, TaskSeed } from "./store-runs";
export type { CreateAgentInput } from "./store-agents";
export type { OperationReservation, ReserveOperationInput } from "./store-operations";
export type { AgenticSignalKind, AgenticTurnSignal, RecordSignalInput } from "./store-signals";
