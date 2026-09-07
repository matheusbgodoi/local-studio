import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

export type PiTurnEventSource = Pick<AgentSession, "subscribe">;

export class PiTurnFailure extends Error {
  constructor(
    message: string,
    readonly compaction: "succeeded" | "failed" | null,
  ) {
    super(message);
    this.name = "PiTurnFailure";
  }
}

export function observePiTurn(
  session: PiTurnEventSource,
  operation: () => Promise<void>,
): Promise<void> {
  let terminalError: string | null = null;
  let compaction: PiTurnFailure["compaction"] = null;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "compaction_end") {
      compaction = event.result && !event.aborted ? "succeeded" : "failed";
      return;
    }
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    terminalError =
      event.message.stopReason === "error"
        ? event.message.errorMessage?.trim() || "The model inference failed."
        : null;
  });
  return Effect.runPromise(
    Effect.tryPromise({ try: operation, catch: (error) => error }).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          terminalError ? Effect.fail(new PiTurnFailure(terminalError, compaction)) : Effect.void,
        ),
      ),
      Effect.ensuring(Effect.sync(unsubscribe)),
    ),
  );
}

export const CONTEXT_RECOVERY_MESSAGE = {
  customType: "context_recovery",
  content:
    "Resume the unfinished request using the compacted conversation. Preserve completed tool results and continue only the remaining work.",
  display: false,
};
