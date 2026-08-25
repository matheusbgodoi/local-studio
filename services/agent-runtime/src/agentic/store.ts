//
// The durable Run store: one SQLite connection, three sub-stores composed into
// a single object so the scheduler holds one handle and every write lands in
// the same file and the same transactional discipline.
//

import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import { createAgentStore } from "./store-agents";
import { createStoreContext } from "./store-context";
import { createOperationStore } from "./store-operations";
import { createRunStore } from "./store-runs";
import { createSignalStore } from "./store-signals";
import { openAgenticDatabase, withTransaction } from "./schema";
import { drainDeleteCleanupQueue, queueDeleteCleanup } from "./delete-cleanup";

export const AGENTIC_ARTIFACTS_DIRNAME = "agentic-artifacts";

const TERMINAL_RUN_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

const RUN_CHILD_TABLES = [
  "agentic_turn_signals",
  "agentic_events",
  "agentic_checkpoints",
  "agentic_tool_operations",
  "agentic_artifacts",
  "agentic_attempts",
  "agentic_agents",
  "agentic_tasks",
  "agentic_plan_revisions",
] as const;

export function createAgenticStore(dataDir: string, now: () => Date = () => new Date()) {
  const { database, filepath } = openAgenticDatabase(dataDir);
  const context = createStoreContext(database, now);
  const artifactsRoot =
    dataDir === ":memory:"
      ? path.join(process.cwd(), ".agentic-artifacts")
      : path.join(dataDir, AGENTIC_ARTIFACTS_DIRNAME);
  const runStore = createRunStore(context);
  drainDeleteCleanupQueue(dataDir);

  const archiveRun = (runId: string, archived: boolean) => {
    const run = runStore.requireRun(runId);
    if (!TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error("Only completed, failed or cancelled Runs can be archived.");
    }
    return withTransaction(database, () =>
      runStore.updateRun(runId, {
        archivedAtMs: archived ? context.ms() : null,
        ...(archived ? { currentForConversation: false } : {}),
      }),
    );
  };

  const deleteRun = (runId: string): void => {
    const run = runStore.requireRun(runId);
    if (!TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error("Only completed, failed or cancelled Runs can be deleted.");
    }
    if (run.archivedAtMs === null) {
      throw new Error("Archive this Run before deleting it.");
    }
    const artifactDir = path.join(artifactsRoot, runId);
    const quarantineDir = `${artifactDir}.deleting-${randomUUID()}`;
    const quarantined = existsSync(artifactDir);
    if (quarantined) renameSync(artifactDir, quarantineDir);
    try {
      if (quarantined) queueDeleteCleanup(dataDir, [quarantineDir]);
      withTransaction(database, () => {
        context.run("UPDATE agentic_runs SET current_for_conversation = 0 WHERE id = ?", runId);
        for (const table of RUN_CHILD_TABLES) {
          context.run(`DELETE FROM ${table} WHERE run_id = ?`, runId);
        }
        context.run("DELETE FROM agentic_runs WHERE id = ?", runId);
      });
    } catch (error) {
      if (quarantined && existsSync(quarantineDir)) renameSync(quarantineDir, artifactDir);
      throw error;
    }
    if (quarantined) {
      try {
        rmSync(quarantineDir, { recursive: true, force: true });
      } catch {
        // The durable cleanup queue is drained again on the next store open.
      }
      drainDeleteCleanupQueue(dataDir);
    }
  };

  return {
    filepath,
    artifactsRoot,
    now: context.ms,
    appendEvent: context.appendEvent,
    close: (): void => database.close(),
    transaction: <T>(task: () => T): T => withTransaction(database, task),
    tableNames: (): string[] =>
      (
        context.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name") as {
          name?: unknown;
        }[]
      ).map((row) => String(row.name ?? "")),
    ...runStore,
    archiveRun,
    deleteRun,
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
