import { Schema } from "effect";
import { ExecutionPolicySchema } from "./execution-policy";

export const SUBAGENT_RUN_TIMEOUT_MS = 15 * 60_000;
export const SUBAGENT_RESPONSE_TIMEOUT_MS = SUBAGENT_RUN_TIMEOUT_MS + 30_000;
export const SUBAGENT_BODY_LIMIT_BYTES = 256_000;

export const SubagentRunInputSchema = Schema.Struct({
  parentPiSessionId: Schema.String,
  name: Schema.String,
  task: Schema.String,
});

export type SubagentRunInput = typeof SubagentRunInputSchema.Type;

export const SubagentRunSchema = Schema.Struct({
  id: Schema.String,
  parentPiSessionId: Schema.String,
  name: Schema.String,
  task: Schema.String,
  piSessionId: Schema.NullOr(Schema.String),
  status: Schema.Literals(["running", "done", "error", "interrupted"]),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  error: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  executionPolicy: Schema.optional(ExecutionPolicySchema),
});

export type SubagentRun = {
  -readonly [K in keyof typeof SubagentRunSchema.Type]: (typeof SubagentRunSchema.Type)[K];
};
