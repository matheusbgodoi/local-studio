import { Schema } from "effect";

export const BrowserSessionScopeSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
});
