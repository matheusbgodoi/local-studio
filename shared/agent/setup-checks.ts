import { Schema } from "effect";

export const SetupCheckRequirementSchema = Schema.Literals([
  "required",
  "recommended",
  "optional",
]);

export const SetupCheckSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  ok: Schema.Boolean,
  value: Schema.String,
  guidance: Schema.String,
  requirement: SetupCheckRequirementSchema,
});

export const SetupChecksResponseSchema = Schema.Struct({
  checks: Schema.Array(SetupCheckSchema),
});

export type SetupCheck = typeof SetupCheckSchema.Type;
