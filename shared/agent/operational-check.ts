import { Schema } from "effect";

export const OperationalCheckSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("command"), command: Schema.String, cwd: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String, sha256: Schema.String }),
]);

export const ProposedAcceptanceSchema = Schema.Union([
  Schema.String,
  Schema.Struct({ description: Schema.String, check: OperationalCheckSchema }),
]);

export type OperationalCheck = typeof OperationalCheckSchema.Type;
export type ProposedAcceptance = typeof ProposedAcceptanceSchema.Type;

export const OperationalWitnessSchema = Schema.Struct({
  artifactId: Schema.String,
  specHash: Schema.String,
  attemptId: Schema.String,
  planRevision: Schema.Number,
});
