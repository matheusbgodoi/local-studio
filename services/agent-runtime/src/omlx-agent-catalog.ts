import { Effect, Schema } from "effect";
import type { AgentModel } from "../../../shared/agent/models";

const ModelOwners = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      owned_by: Schema.optional(Schema.String),
    }),
  ),
});

const ModelStatus = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      model_type: Schema.optional(Schema.String),
      config_model_type: Schema.optional(Schema.String),
    }),
  ),
});

const nonChatTypes = new Set([
  "audio_tts",
  "audio_stt",
  "audio_sts",
  "embedding",
  "embeddings",
  "reranker",
  "rerank",
  "markitdown",
]);

export function filterOmlxAgentCatalog(
  models: AgentModel[],
  payload: unknown,
  backendUrl: string,
  headers: HeadersInit,
): Promise<AgentModel[]> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const owners = Schema.decodeUnknownSync(ModelOwners)(payload);
        const omlxIds = new Set(
          owners.data.filter((row) => row.owned_by === "omlx").map((row) => row.id),
        );
        if (omlxIds.size === 0) return models;
        const response = await fetch(`${backendUrl}/v1/models/status`, {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return models;
        const status = Schema.decodeUnknownSync(ModelStatus)(await response.json());
        const excluded = new Set(
          status.models
            .filter(
              (row) =>
                omlxIds.has(row.id) &&
                (nonChatTypes.has(row.model_type ?? "") ||
                  row.config_model_type === "s3_tokenizer_v2"),
            )
            .map((row) => row.id),
        );
        return models.filter((model) => !excluded.has(model.id));
      },
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.succeed(models))),
  );
}
