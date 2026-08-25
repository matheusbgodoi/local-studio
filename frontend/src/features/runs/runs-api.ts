import { Effect, Schema } from "effect";
import {
  AgenticRunResponseSchema,
  AgenticRunSnapshotSchema,
  AgenticRunsResponseSchema,
  type AgenticRun,
  type AgenticRunSnapshot,
} from "@shared/agent/agentic-run";

async function errorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with HTTP ${response.status}`;
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function requestJson<A>(
  input: string,
  decode: (input: unknown) => A,
  init?: RequestInit,
): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(input, { cache: "no-store", ...init });
      if (!response.ok) throw new Error(await errorMessage(response));
      return decode(await response.json());
    },
    catch: (error) => (error instanceof Error ? error : new Error("Run request failed")),
  });
}

export function listRuns(): Effect.Effect<AgenticRun[], Error> {
  return Effect.map(
    requestJson("/api/agent/runs", Schema.decodeUnknownSync(AgenticRunsResponseSchema)),
    ({ runs }) => [...runs],
  );
}

export function loadRunSnapshot(runId: string): Effect.Effect<AgenticRunSnapshot, Error> {
  return requestJson(
    `/api/agent/runs/${encodeURIComponent(runId)}`,
    Schema.decodeUnknownSync(AgenticRunSnapshotSchema),
  );
}

export function resumeRun(runId: string): Effect.Effect<AgenticRun, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/runs/${encodeURIComponent(runId)}/resume`,
      Schema.decodeUnknownSync(AgenticRunResponseSchema),
      { method: "POST" },
    ),
    ({ run }) => run,
  );
}

export function cancelRun(runId: string): Effect.Effect<AgenticRun, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/runs/${encodeURIComponent(runId)}/cancel`,
      Schema.decodeUnknownSync(AgenticRunResponseSchema),
      { method: "POST" },
    ),
    ({ run }) => run,
  );
}

export function setRunArchived(runId: string, archived: boolean): Effect.Effect<AgenticRun, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/runs/${encodeURIComponent(runId)}`,
      Schema.decodeUnknownSync(AgenticRunResponseSchema),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      },
    ),
    ({ run }) => run,
  );
}

const DeleteRunResponseSchema = Schema.Struct({ ok: Schema.Literal(true) });

export function deleteRun(runId: string): Effect.Effect<void, Error> {
  return Effect.asVoid(
    requestJson(
      `/api/agent/runs/${encodeURIComponent(runId)}`,
      Schema.decodeUnknownSync(DeleteRunResponseSchema),
      { method: "DELETE" },
    ),
  );
}
