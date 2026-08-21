//
// Tool operations, artifacts and compaction checkpoints.
//
// A side-effecting operation carries an idempotency key and a request hash.
// After a crash the runtime asks this table what it had already done, and an
// operation that was in flight is handed back for RECONCILIATION against the
// real external state rather than blindly replayed.
//

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  AgenticArtifact,
  AgenticCheckpoint,
  AgenticOperationStatus,
  AgenticToolOperation,
  AgenticWorkingSet,
} from "./contract";
import { toArtifact, toCheckpoint, toOperation } from "./rows";
import type { AgenticStoreContext } from "./store-context";

export type ReserveOperationInput = {
  idempotencyKey: string;
  runId: string;
  taskId: string;
  attemptId: string | null;
  action: string;
  request: unknown;
  sideEffecting: boolean;
};

export type OperationReservation =
  | { kind: "reserved"; operation: AgenticToolOperation }
  | { kind: "cached"; operation: AgenticToolOperation }
  | { kind: "reconcile"; operation: AgenticToolOperation }
  | { kind: "mismatch"; operation: AgenticToolOperation };

export type RecordArtifactInput = {
  runId: string;
  taskId: string | null;
  kind: string;
  label: string;
  mediaType: string;
  provenance: string;
  content: string;
};

export const hashRequest = (request: unknown): string =>
  createHash("sha256").update(JSON.stringify(request ?? null)).digest("hex");

//
// Four characters per token is the ratio the runtime uses everywhere it must
// size a payload it has not tokenised. It is deliberately an over-estimate for
// prose and an under-estimate for nothing that matters: the budget only needs
// to know whether a payload is small, large, or absurd.
//
export const estimateTokens = (content: string): number => Math.ceil(content.length / 4);

const PREVIEW_HEAD = 1200;
const PREVIEW_TAIL = 600;

export const buildPreview = (content: string): string => {
  if (content.length <= PREVIEW_HEAD + PREVIEW_TAIL) return content;
  const head = content.slice(0, PREVIEW_HEAD);
  const tail = content.slice(-PREVIEW_TAIL);
  const elided = content.length - PREVIEW_HEAD - PREVIEW_TAIL;
  return `${head}\n… [${elided} characters externalised] …\n${tail}`;
};

export function createOperationStore(context: AgenticStoreContext, artifactsRoot: string) {
  const { all, one, ms, appendEvent } = context;

  const getOperation = (key: string): AgenticToolOperation | null => {
    const row = one("SELECT * FROM agentic_tool_operations WHERE idempotency_key = ?", key);
    return row ? toOperation(row) : null;
  };

  const requireOperation = (key: string): AgenticToolOperation => {
    const operation = getOperation(key);
    if (!operation) throw new Error(`Unknown agentic tool operation: ${key}`);
    return operation;
  };

  const setStatus = (
    key: string,
    status: AgenticOperationStatus,
    patch: { externalState?: string | null; resultArtifactId?: string | null; result?: unknown } = {},
  ): AgenticToolOperation => {
    const current = requireOperation(key);
    context.run(
      `UPDATE agentic_tool_operations SET status = ?, external_state = ?, result_artifact_id = ?,
         result_json = ?, updated_at_ms = ? WHERE idempotency_key = ?`,
      status,
      patch.externalState === undefined ? current.externalState : patch.externalState,
      patch.resultArtifactId === undefined ? current.resultArtifactId : patch.resultArtifactId,
      patch.result === undefined ? JSON.stringify(current.result ?? null) : JSON.stringify(patch.result ?? null),
      ms(),
      key,
    );
    return requireOperation(key);
  };

  const reserveOperation = (input: ReserveOperationInput): OperationReservation => {
    const requestHash = hashRequest(input.request);
    const existing = getOperation(input.idempotencyKey);
    if (!existing) {
      const at = ms();
      context.run(
        `INSERT INTO agentic_tool_operations(idempotency_key, run_id, task_id, attempt_id, action,
           request_hash, status, side_effecting, created_at_ms, updated_at_ms)
         VALUES (?,?,?,?,?,?,'PLANNED',?,?,?)`,
        input.idempotencyKey,
        input.runId,
        input.taskId,
        input.attemptId,
        input.action,
        requestHash,
        input.sideEffecting ? 1 : 0,
        at,
        at,
      );
      appendEvent({
        runId: input.runId,
        taskId: input.taskId,
        type: "OPERATION_STARTED",
        summary: input.action,
        detail: { idempotencyKey: input.idempotencyKey, sideEffecting: input.sideEffecting },
      });
      return { kind: "reserved", operation: requireOperation(input.idempotencyKey) };
    }
    if (existing.requestHash !== requestHash) return { kind: "mismatch", operation: existing };
    if (existing.status === "COMMITTED") return { kind: "cached", operation: existing };
    if (existing.sideEffecting && (existing.status === "STARTED" || existing.status === "UNKNOWN")) {
      return { kind: "reconcile", operation: existing };
    }
    return { kind: "reserved", operation: existing };
  };

  const artifactDirFor = (runId: string): string => {
    const dir = path.join(artifactsRoot, runId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  };

  const recordArtifact = (input: RecordArtifactInput): AgenticArtifact => {
    const id = `artifact_${randomUUID()}`;
    const dir = artifactDirFor(input.runId);
    const relativePath = path.join(input.runId, `${id}.txt`);
    writeFileSync(path.join(dir, `${id}.txt`), input.content, { mode: 0o600 });
    context.run(
      `INSERT INTO agentic_artifacts(id, run_id, task_id, kind, label, media_type, byte_size,
         token_estimate, digest, relative_path, preview, provenance, created_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.runId,
      input.taskId,
      input.kind,
      input.label,
      input.mediaType,
      Buffer.byteLength(input.content, "utf8"),
      estimateTokens(input.content),
      createHash("sha256").update(input.content).digest("hex"),
      relativePath,
      buildPreview(input.content),
      input.provenance,
      ms(),
    );
    appendEvent({
      runId: input.runId,
      taskId: input.taskId,
      type: "ARTIFACT_EXTERNALISED",
      summary: input.label,
      detail: { artifactId: id, byteSize: Buffer.byteLength(input.content, "utf8") },
    });
    const row = one("SELECT * FROM agentic_artifacts WHERE id = ?", id);
    if (!row) throw new Error("Failed to persist agentic artifact");
    return toArtifact(row);
  };

  const getArtifact = (id: string): AgenticArtifact | null => {
    const row = one("SELECT * FROM agentic_artifacts WHERE id = ?", id);
    return row ? toArtifact(row) : null;
  };

  const readArtifactSlice = (id: string, offset = 0, length = 4000): string | null => {
    const artifact = getArtifact(id);
    if (!artifact) return null;
    const content = readFileSync(path.join(artifactsRoot, artifact.relativePath), "utf8");
    const start = Math.max(0, Math.floor(offset));
    return content.slice(start, start + Math.max(0, Math.floor(length)));
  };

  const recordCheckpoint = (input: {
    runId: string;
    taskId: string | null;
    reason: string;
    tokensBefore: number;
    tokensAfter: number;
    targetTokens: number;
    usableLimit: number;
    durationMs: number;
    workingSet: AgenticWorkingSet;
  }): AgenticCheckpoint => {
    const id = `checkpoint_${randomUUID()}`;
    const previous = one(
      "SELECT MAX(sequence) AS sequence FROM agentic_checkpoints WHERE run_id = ?",
      input.runId,
    );
    const sequence = Number(previous?.sequence ?? 0) + 1;
    context.run(
      `INSERT INTO agentic_checkpoints(id, run_id, task_id, sequence, reason, tokens_before,
         tokens_after, target_tokens, usable_limit, duration_ms, working_set_json, created_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.runId,
      input.taskId,
      sequence,
      input.reason,
      input.tokensBefore,
      input.tokensAfter,
      input.targetTokens,
      input.usableLimit,
      input.durationMs,
      JSON.stringify(input.workingSet),
      ms(),
    );
    const row = one("SELECT * FROM agentic_checkpoints WHERE id = ?", id);
    if (!row) throw new Error("Failed to persist agentic checkpoint");
    return toCheckpoint(row);
  };

  return {
    reserveOperation,
    getOperation,
    markOperationStarted: (key: string): AgenticToolOperation => setStatus(key, "STARTED"),
    commitOperation: (
      key: string,
      patch: { result?: unknown; resultArtifactId?: string | null; externalState?: string | null } = {},
    ): AgenticToolOperation => setStatus(key, "COMMITTED", patch),
    failOperation: (key: string, externalState: string | null = null): AgenticToolOperation =>
      setStatus(key, "FAILED", { externalState }),
    markOperationUnknown: (key: string, externalState: string | null = null): AgenticToolOperation =>
      setStatus(key, "UNKNOWN", { externalState }),
    listOperations: (runId: string): AgenticToolOperation[] =>
      all("SELECT * FROM agentic_tool_operations WHERE run_id = ? ORDER BY created_at_ms ASC", runId).map(
        toOperation,
      ),
    recordArtifact,
    getArtifact,
    readArtifactSlice,
    listArtifacts: (runId: string): AgenticArtifact[] =>
      all("SELECT * FROM agentic_artifacts WHERE run_id = ? ORDER BY created_at_ms ASC", runId).map(
        toArtifact,
      ),
    recordCheckpoint,
    listCheckpoints: (runId: string): AgenticCheckpoint[] =>
      all("SELECT * FROM agentic_checkpoints WHERE run_id = ? ORDER BY sequence ASC", runId).map(
        toCheckpoint,
      ),
    latestCheckpoint: (runId: string): AgenticCheckpoint | null => {
      const row = one(
        "SELECT * FROM agentic_checkpoints WHERE run_id = ? ORDER BY sequence DESC LIMIT 1",
        runId,
      );
      return row ? toCheckpoint(row) : null;
    },
  };
}
