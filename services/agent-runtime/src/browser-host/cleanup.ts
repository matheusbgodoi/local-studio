import { Effect } from "effect";

const CLEANUP_TIMEOUT_MS = 5_000;

type CleanupStage = "browser startup" | "context closure" | "temporary profile removal";

export function finishBrowserCleanup(
  stage: CleanupStage,
  task: () => Promise<unknown>,
): Promise<boolean> {
  return Effect.runPromise(
    Effect.tryPromise({ try: task, catch: () => undefined }).pipe(
      Effect.timeout(CLEANUP_TIMEOUT_MS),
      Effect.match({
        onSuccess: () => true,
        onFailure: () => {
          console.warn(
            `[browser] ${stage} did not settle within cleanup bounds; resources may remain`,
          );
          return false;
        },
      }),
    ),
  );
}
