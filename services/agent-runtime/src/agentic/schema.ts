//
// Durable schema for the agentic runtime.
//
// Task state must not live only in the model's context, so it lives here: a
// STRICT SQLite file beside the rest of the user data, opened through the same
// bun:sqlite / node:sqlite shim the Litter ledger uses because this package is
// typechecked by bun and shipped as `node dist/server.js`.
//
// Every table is prefixed `agentic_` on purpose. The controller sweeps a list
// of legacy table names — `runs`, `sessions`, `messages`, `usage` — on every
// open (controller/src/stores/sqlite.ts), and a durable store named `runs`
// would be dropped out from under itself.
//

import { chmodSync, closeSync, constants, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type SqlStatement = {
  run(...values: unknown[]): { changes: number };
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
};

export type SqlDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
};

const runtimeRequire = createRequire(import.meta.url);

export const loadSqlDatabase = (): new (filepath: string) => SqlDatabase => {
  const bunVersion = (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun;
  if (bunVersion) {
    return (runtimeRequire("bun:sqlite") as { Database: new (filepath: string) => SqlDatabase })
      .Database;
  }
  return (runtimeRequire("node:sqlite") as { DatabaseSync: new (filepath: string) => SqlDatabase })
    .DatabaseSync;
};

export const AGENTIC_STORE_FILENAME = "agentic-runtime.sqlite";
export const AGENTIC_STORE_VERSION = 5;

const DDL = `
CREATE TABLE IF NOT EXISTS agentic_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agentic_runs (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATED','PLANNING','RUNNING','PAUSED','WAITING_USER','COMPLETING','COMPLETED','FAILED','CANCELLED')),
  model_id TEXT NOT NULL,
  physical_model_id TEXT NOT NULL,
  model_display_name TEXT,
  behavior_profile TEXT,
  network_policy TEXT NOT NULL DEFAULT 'direct' CHECK (network_policy IN ('direct','vpn_protected')),
  context_window INTEGER NOT NULL,
  usable_limit INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  pi_session_id TEXT,
  cwd TEXT NOT NULL,
  plan_revision INTEGER NOT NULL DEFAULT 0,
  active_task_id TEXT,
  cumulative_input_tokens INTEGER NOT NULL DEFAULT 0,
  cumulative_output_tokens INTEGER NOT NULL DEFAULT 0,
  cumulative_cache_tokens INTEGER NOT NULL DEFAULT 0,
  compaction_count INTEGER NOT NULL DEFAULT 0,
  latest_checkpoint_id TEXT,
  result_summary TEXT,
  failure_reason TEXT,
  recovery_state TEXT,
  archived_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agentic_plan_revisions (
  run_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  dag_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (run_id, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS agentic_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','READY','RUNNING','BLOCKED','WAITING_USER','SUCCEEDED','FAILED','CANCELLED')),
  dependencies_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT,
  result_summary TEXT,
  evidence_json TEXT,
  blocker TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  settled_at_ms INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_tasks_run ON agentic_tasks(run_id, position);

CREATE TABLE IF NOT EXISTS agentic_agents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IDLE','WORKING','COMPACTING','WAITING','INTERRUPTED','FINISHED')),
  model_id TEXT NOT NULL,
  physical_model_id TEXT NOT NULL,
  model_display_name TEXT,
  behavior_profile TEXT,
  current_task_id TEXT,
  session_id TEXT NOT NULL,
  pi_session_id TEXT,
  active_context_tokens INTEGER NOT NULL DEFAULT 0,
  context_limit INTEGER NOT NULL DEFAULT 0,
  cumulative_input_tokens INTEGER NOT NULL DEFAULT 0,
  cumulative_output_tokens INTEGER NOT NULL DEFAULT 0,
  compaction_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_agents_run ON agentic_agents(run_id);

CREATE TABLE IF NOT EXISTS agentic_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','INTERRUPTED','ABANDONED')),
  outcome TEXT,
  evidence_json TEXT,
  error TEXT,
  started_at_ms INTEGER NOT NULL,
  settled_at_ms INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_attempts_task ON agentic_attempts(task_id, attempt);

CREATE TABLE IF NOT EXISTS agentic_tool_operations (
  idempotency_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt_id TEXT,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED','STARTED','COMMITTED','FAILED','UNKNOWN')),
  side_effecting INTEGER NOT NULL,
  external_state TEXT,
  result_artifact_id TEXT,
  result_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_tool_operations_run ON agentic_tool_operations(run_id, task_id);

CREATE TABLE IF NOT EXISTS agentic_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL,
  digest TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  preview TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_artifacts_run ON agentic_artifacts(run_id);

CREATE TABLE IF NOT EXISTS agentic_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT,
  sequence INTEGER NOT NULL,
  reason TEXT NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  target_tokens INTEGER NOT NULL,
  usable_limit INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  working_set_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_checkpoints_run ON agentic_checkpoints(run_id, sequence);

CREATE TABLE IF NOT EXISTS agentic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_events_run ON agentic_events(run_id, id);

CREATE TABLE IF NOT EXISTS agentic_turn_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  turn_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('evidence','complete','blocked','needs_user')),
  detail TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS agentic_turn_signals_run ON agentic_turn_signals(run_id, consumed, id);
`;

const createOwnerOnlyFile = (filepath: string): void => {
  try {
    closeSync(openSync(filepath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600));
  } catch {
    // The file already exists; the chmod below still enforces the mode.
  }
};

export function openAgenticDatabase(dataDir: string): { database: SqlDatabase; filepath: string } {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filepath = path.join(dataDir, AGENTIC_STORE_FILENAME);
  const memory = dataDir === ":memory:";
  const target = memory ? ":memory:" : filepath;
  if (!memory) createOwnerOnlyFile(target);

  const RuntimeDatabase = loadSqlDatabase();
  const database = new RuntimeDatabase(target);
  database.exec("PRAGMA busy_timeout = 10000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA trusted_schema = OFF");
  database.exec(DDL);

  //
  // Every table above is CREATE TABLE IF NOT EXISTS, so opening an older store
  // with newer code adds what is missing and leaves the rows alone. Migrating
  // forward is the whole job; the only unrecoverable case is a store written
  // by code newer than this, which must not be guessed at.
  //
  // A table that already exists, however, is left exactly as it was — CREATE
  // TABLE IF NOT EXISTS cannot add a column to one. Every column introduced
  // after a table shipped therefore needs an explicit additive step, or an
  // existing store keeps the old shape and the first INSERT fails on a column
  // that is not there.
  //
  addMissingColumns(database);
  database
    .prepare("INSERT OR IGNORE INTO agentic_metadata(key, value) VALUES ('version', ?)")
    .run(String(AGENTIC_STORE_VERSION));
  const stored = database
    .prepare("SELECT value FROM agentic_metadata WHERE key = 'version'")
    .get() as { value?: unknown } | undefined;
  const storedVersion = Number(stored?.value);
  if (!Number.isFinite(storedVersion) || storedVersion > AGENTIC_STORE_VERSION) {
    database.close();
    throw new Error(
      `Agentic runtime store was written by a newer build (version ${String(stored?.value)})`,
    );
  }
  if (storedVersion < AGENTIC_STORE_VERSION) {
    database
      .prepare("UPDATE agentic_metadata SET value = ? WHERE key = 'version'")
      .run(String(AGENTIC_STORE_VERSION));
  }

  if (!memory) {
    try {
      chmodSync(target, 0o600);
    } catch {
      // best-effort
    }
  }
  return { database, filepath: target };
}

//
// Additive only, and idempotent: a column already present is left alone, and
// nothing here drops, renames or rewrites anything. A NOT NULL column needs a
// DEFAULT so the rows that predate it get a value — `direct` is the right one,
// because a Run that was created before this existed was not protected, and
// backfilling it as protected would claim a guarantee nothing ever provided.
//
function addMissingColumns(database: SqlDatabase): void {
  const additions: ReadonlyArray<{ table: string; column: string; definition: string }> = [
    {
      table: "agentic_runs",
      column: "network_policy",
      definition:
        "TEXT NOT NULL DEFAULT 'direct' CHECK (network_policy IN ('direct','vpn_protected'))",
    },
    {
      table: "agentic_runs",
      column: "archived_at_ms",
      definition: "INTEGER",
    },
    { table: "agentic_runs", column: "model_display_name", definition: "TEXT" },
    { table: "agentic_agents", column: "model_display_name", definition: "TEXT" },
  ];
  for (const addition of additions) {
    const columns = database.prepare(`PRAGMA table_info(${addition.table})`).all() as Array<{
      name?: unknown;
    }>;
    if (columns.length === 0) continue;
    if (columns.some((column) => column.name === addition.column)) continue;
    database.exec(
      `ALTER TABLE ${addition.table} ADD COLUMN ${addition.column} ${addition.definition}`,
    );
  }
}

export function withTransaction<T>(database: SqlDatabase, task: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = task();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The rollback of a failed transaction is best-effort by design.
    }
    throw error;
  }
}
