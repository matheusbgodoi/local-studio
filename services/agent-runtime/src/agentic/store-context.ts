//
// The handful of primitives every sub-store shares: typed row access, the
// clock, and the event log. Kept apart so the run, agent and operation stores
// can be read independently without any of them owning the connection.
//

import type { Row } from "./rows";
import type { SqlDatabase } from "./schema";

export type AgenticEventInput = {
  runId: string;
  taskId?: string | null;
  agentId?: string | null;
  type: string;
  summary: string;
  detail?: unknown;
};

export type AgenticStoreContext = {
  database: SqlDatabase;
  ms: () => number;
  all: (sql: string, ...values: unknown[]) => Row[];
  one: (sql: string, ...values: unknown[]) => Row | null;
  run: (sql: string, ...values: unknown[]) => void;
  appendEvent: (input: AgenticEventInput) => void;
};

export function createStoreContext(
  database: SqlDatabase,
  now: () => Date,
): AgenticStoreContext {
  const ms = (): number => now().getTime();

  const context: AgenticStoreContext = {
    database,
    ms,
    all: (sql, ...values) => database.prepare(sql).all(...values) as Row[],
    one: (sql, ...values) => (database.prepare(sql).get(...values) as Row | undefined) ?? null,
    run: (sql, ...values) => {
      database.prepare(sql).run(...values);
    },
    appendEvent: (input) => {
      database
        .prepare(
          "INSERT INTO agentic_events(run_id, task_id, agent_id, type, summary, detail_json, created_at_ms) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          input.runId,
          input.taskId ?? null,
          input.agentId ?? null,
          input.type,
          input.summary,
          input.detail === undefined ? null : JSON.stringify(input.detail),
          ms(),
        );
    },
  };

  return context;
}

export function buildPatch(
  columns: Record<string, string>,
  patch: Record<string, unknown>,
): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }
  return { assignments, values };
}
