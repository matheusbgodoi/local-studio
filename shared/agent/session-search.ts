import { Schema } from "effect";

export const SessionSearchResultSchema = Schema.Struct({
  sessionId: Schema.String,
  projectId: Schema.String,
  projectName: Schema.String,
  title: Schema.NullOr(Schema.String),
  snippet: Schema.String,
  archived: Schema.Boolean,
  updatedAt: Schema.String,
});

export const SessionSearchResponseSchema = Schema.Struct({
  results: Schema.Array(SessionSearchResultSchema),
});

export type SessionSearchResult = typeof SessionSearchResultSchema.Type;
export type SessionSearchResponse = typeof SessionSearchResponseSchema.Type;
