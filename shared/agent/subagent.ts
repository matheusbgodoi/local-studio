import { Schema } from "effect";

export const SUBAGENT_RUN_TIMEOUT_MS = 15 * 60_000;
export const SUBAGENT_BODY_LIMIT_BYTES = 256_000;

export const SubagentRunInputSchema = Schema.Struct({
  parentPiSessionId: Schema.String,
  name: Schema.String,
  task: Schema.String,
  modelId: Schema.optional(Schema.String),
});

export type SubagentRunInput = typeof SubagentRunInputSchema.Type;
