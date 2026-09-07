import { Schema } from "effect";

export const PersonalMemoryModeSchema = Schema.Literals(["off", "automatic"]);
export const PersonalKnowledgeModeSchema = Schema.Literals(["off", "automatic", "required"]);
export const PersonalMemoryCategorySchema = Schema.Literals([
  "preference",
  "identity",
  "work",
  "communication",
  "restriction",
  "goal",
  "other",
]);
export const PersonalMemorySensitivitySchema = Schema.Literals(["standard", "local_only"]);
export const PersonalMemorySourceSchema = Schema.Literals(["manual", "conversation"]);

export const PersonalMemoryEntrySchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  category: PersonalMemoryCategorySchema,
  source: PersonalMemorySourceSchema,
  sensitivity: PersonalMemorySensitivitySchema,
  enabled: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const PersonalMemoryDocumentSchema = Schema.Struct({
  version: Schema.Literal(1),
  mode: PersonalMemoryModeSchema,
  knowledgeMode: PersonalKnowledgeModeSchema,
  entries: Schema.Array(PersonalMemoryEntrySchema),
  updatedAt: Schema.String,
});

export const PersonalMemoryCreateSchema = Schema.Struct({
  text: Schema.String,
  category: Schema.optional(PersonalMemoryCategorySchema),
  sensitivity: Schema.optional(PersonalMemorySensitivitySchema),
});

export const PersonalMemoryUpdateSchema = Schema.Struct({
  text: Schema.optional(Schema.String),
  category: Schema.optional(PersonalMemoryCategorySchema),
  sensitivity: Schema.optional(PersonalMemorySensitivitySchema),
  enabled: Schema.optional(Schema.Boolean),
});

export const PersonalMemorySettingsUpdateSchema = Schema.Struct({
  mode: Schema.optional(PersonalMemoryModeSchema),
  knowledgeMode: Schema.optional(PersonalKnowledgeModeSchema),
});

export const PersonalMemoryDeleteSchema = Schema.Struct({
  ids: Schema.optional(Schema.Array(Schema.String)),
  all: Schema.optional(Schema.Boolean),
});

export type PersonalMemoryMode = typeof PersonalMemoryModeSchema.Type;
export type PersonalKnowledgeMode = typeof PersonalKnowledgeModeSchema.Type;
export type PersonalMemoryCategory = typeof PersonalMemoryCategorySchema.Type;
export type PersonalMemorySensitivity = typeof PersonalMemorySensitivitySchema.Type;
export type PersonalMemorySource = typeof PersonalMemorySourceSchema.Type;
export type PersonalMemoryEntry = typeof PersonalMemoryEntrySchema.Type;
export type PersonalMemoryDocument = typeof PersonalMemoryDocumentSchema.Type;
export type PersonalMemoryCreate = typeof PersonalMemoryCreateSchema.Type;
export type PersonalMemoryUpdate = typeof PersonalMemoryUpdateSchema.Type;
export type PersonalMemorySettingsUpdate = typeof PersonalMemorySettingsUpdateSchema.Type;

export const PERSONAL_MEMORY_MAX_ENTRIES = 60;
export const PERSONAL_MEMORY_MAX_TEXT = 280;
export const PERSONAL_MEMORY_PROMPT_CHARACTERS = 2_000;
