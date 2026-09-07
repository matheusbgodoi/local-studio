//
// Structured turn signals.
//
// The runtime used to learn what a turn achieved by matching magic strings in
// the model's prose. A model that forgot the exact spelling silently made no
// progress, and the stall detector eventually failed the Run over a formatting
// slip. Signals are written by the control tools instead — a state transition
// the runtime validated, not a string it hoped to find.
//
// Text markers still parse, as a fallback for a turn that reported in prose,
// but they are no longer the protocol.
//

import type { AgenticStoreContext } from "./store-context";
import { int, nullableText, parseJson, text, type Row } from "./rows";

export const AGENTIC_SIGNAL_KINDS = ["evidence", "complete", "blocked", "needs_user"] as const;

export type AgenticSignalKind = (typeof AGENTIC_SIGNAL_KINDS)[number];

export type AgenticTurnSignal = {
  id: number;
  runId: string;
  taskId: string | null;
  agentId: string | null;
  turnId: number;
  kind: AgenticSignalKind;
  detail: { criterion?: string; evidence?: string; reason?: string; question?: string };
  createdAtMs: number;
};

const toSignal = (row: Row): AgenticTurnSignal => ({
  id: int(row.id),
  runId: text(row.run_id),
  taskId: nullableText(row.task_id),
  agentId: nullableText(row.agent_id),
  turnId: int(row.turn_id),
  kind: text(row.kind) as AgenticSignalKind,
  detail: parseJson<AgenticTurnSignal["detail"]>(row.detail, {}),
  createdAtMs: int(row.created_at_ms),
});

export type RecordSignalInput = {
  runId: string;
  taskId: string | null;
  agentId: string | null;
  turnId: number;
  kind: AgenticSignalKind;
  detail: AgenticTurnSignal["detail"];
};

export function createSignalStore(context: AgenticStoreContext) {
  const { all, ms } = context;

  return {
    recordSignal: (input: RecordSignalInput): void => {
      context.run(
        `INSERT INTO agentic_turn_signals(run_id, task_id, agent_id, turn_id, kind, detail, created_at_ms)
         VALUES (?,?,?,?,?,?,?)`,
        input.runId,
        input.taskId,
        input.agentId,
        Math.max(0, Math.floor(input.turnId)),
        input.kind,
        JSON.stringify(input.detail ?? {}),
        ms(),
      );
    },

    //
    // Taking a signal marks it consumed in the same statement that reads it, so
    // a step that runs twice cannot adjudicate the same report twice.
    //
    takePendingSignals: (runId: string): AgenticTurnSignal[] => {
      const pending = all(
        "SELECT * FROM agentic_turn_signals WHERE run_id = ? AND consumed = 0 ORDER BY id ASC",
        runId,
      ).map(toSignal);
      if (pending.length === 0) return [];
      context.run(
        "UPDATE agentic_turn_signals SET consumed = 1 WHERE run_id = ? AND consumed = 0",
        runId,
      );
      return pending;
    },

    listSignals: (runId: string): AgenticTurnSignal[] =>
      all("SELECT * FROM agentic_turn_signals WHERE run_id = ? ORDER BY id ASC", runId).map(toSignal),
  };
}
