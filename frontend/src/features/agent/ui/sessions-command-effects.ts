import { Effect, Schema } from "effect";
import { safeJson } from "@/features/agent/safe-json";
import type { AggregatedSession } from "@shared/agent/session-summary";
import {
  SessionSearchResponseSchema,
  type SessionSearchResult,
} from "@shared/agent/session-search";

export function loadAggregatedSessions(): Promise<AggregatedSession[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch("/api/agent/sessions/all?since=30d", { cache: "no-store" }),
        catch: (error) => error,
      });
      const payload = yield* Effect.tryPromise({
        try: () => safeJson<{ sessions?: AggregatedSession[] }>(response),
        catch: (error) => error,
      });
      return payload.sessions ?? [];
    }),
  );
}

export function searchConversationTranscripts(
  query: string,
  signal: AbortSignal,
): Promise<SessionSearchResult[]> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(
          `/api/agent/sessions/search?q=${encodeURIComponent(query)}&limit=40`,
          { cache: "no-store", signal },
        );
        if (!response.ok)
          throw new Error(`Conversation search failed with HTTP ${response.status}`);
        return [
          ...Schema.decodeUnknownSync(SessionSearchResponseSchema)(await safeJson(response))
            .results,
        ];
      },
      catch: (error) => (error instanceof Error ? error : new Error("Conversation search failed")),
    }),
  );
}
