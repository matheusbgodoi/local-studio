//
// Where the durable mechanisms meet real tool execution.
//
// Two hooks, both no-ops outside a Run so ordinary chat is untouched:
//
//   tool_call   — a side-effecting operation is reserved in the ledger before
//                 it runs, and one that was in flight when a process died is
//                 blocked until the model has checked the real external state.
//   tool_result — an output too large to belong in context becomes a durable
//                 artifact, and what reaches the model is a reference plus the
//                 head and tail of what it said.
//
// The alternative to the second one is what the P0 handoff described: the same
// build log re-pasted into every request until the window is gone.
//

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgenticRun } from "./contract";
import { hashRequest } from "./store-operations";
import type { AgenticStore } from "./store";

export const DEFAULT_PREVIEW_BUDGET_BYTES = 6_000;

//
// Tools that can change something outside this process. A read, a grep or a
// listing can be repeated freely; these cannot be repeated without thought.
//
export const DEFAULT_SIDE_EFFECTING_TOOLS = ["bash", "write", "edit"] as const;

export type ToolInterceptorPolicy = {
  previewBudgetBytes: number;
  sideEffectingTools: readonly string[];
};

export const DEFAULT_TOOL_INTERCEPTOR_POLICY: ToolInterceptorPolicy = {
  previewBudgetBytes: DEFAULT_PREVIEW_BUDGET_BYTES,
  sideEffectingTools: DEFAULT_SIDE_EFFECTING_TOOLS,
};

export type ToolInterceptorDeps = {
  //
  // Resolved per hook, not at load: the runtime is constructed at boot but a
  // session that outlives a restart must not hold a stale handle.
  //
  store: () => AgenticStore | null;
  activeRun: () => AgenticRun | null;
  policy?: Partial<ToolInterceptorPolicy>;
};

type PendingOperation = { key: string; runId: string; taskId: string };

const textOf = (content: readonly { type?: string; text?: string }[]): string =>
  content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");

export function artifactReference(input: {
  toolName: string;
  artifactId: string;
  byteSize: number;
  tokenEstimate: number;
  preview: string;
}): string {
  return [
    `[${input.toolName} produced ${input.byteSize} bytes (~${input.tokenEstimate} tokens); the runtime stored it as ${input.artifactId}]`,
    "Head and tail follow. Use read_agentic_artifact with that id to read any other part; do not ask for it to be repeated.",
    "",
    input.preview,
  ].join("\n");
}

export function createToolInterceptor(deps: ToolInterceptorDeps) {
  const policy = { ...DEFAULT_TOOL_INTERCEPTOR_POLICY, ...deps.policy };
  const pending = new Map<string, PendingOperation>();

  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", (event) => {
      const store = deps.store();
      const run = deps.activeRun();
      if (!store || !run) return;
      const toolName = (event as { toolName?: string }).toolName ?? "";
      if (!policy.sideEffectingTools.includes(toolName)) return;
      const taskId = run.activeTaskId;
      if (!taskId) return;

      const request = { tool: toolName, input: (event as { input?: unknown }).input ?? null };
      const key = `${run.id}:${taskId}:${hashRequest(request)}`;
      const reservation = store.reserveOperation({
        idempotencyKey: key,
        runId: run.id,
        taskId,
        attemptId: null,
        action: toolName,
        request,
        sideEffecting: true,
      });

      if (reservation.kind === "reconcile") {
        //
        // The last process died between starting this and recording what it
        // did. Repeating it blindly is exactly what must never happen, so the
        // model is told to go and look instead.
        //
        return {
          block: true,
          reason: `This exact operation was already in flight when a previous process ended, and it may have completed. Check the real state first (for example with a read-only command), then proceed accordingly. Operation ${key}.`,
        };
      }
      if (reservation.kind === "mismatch") {
        return { block: true, reason: "An operation with this identity already exists with different arguments." };
      }

      store.markOperationStarted(key);
      pending.set(event.toolCallId, { key, runId: run.id, taskId });
      if (reservation.operation.status === "COMMITTED") {
        store.appendEvent({
          runId: run.id,
          taskId,
          type: "OPERATION_REPEATED",
          summary: `${toolName} ran again with identical arguments`,
        });
      }
      return;
    });

    pi.on("tool_result", (event) => {
      const store = deps.store();
      const run = deps.activeRun();
      if (!store || !run) return;

      const toolName = (event as { toolName?: string }).toolName ?? "tool";
      const content = (event as { content?: { type?: string; text?: string }[] }).content ?? [];
      const body = textOf(content);
      const byteSize = Buffer.byteLength(body, "utf8");
      const oversized = byteSize > policy.previewBudgetBytes;

      let artifactId: string | null = null;
      let replacement: { content: { type: "text"; text: string }[] } | undefined;

      if (oversized) {
        const artifact = store.recordArtifact({
          runId: run.id,
          taskId: run.activeTaskId,
          kind: "tool-output",
          label: `${toolName} output`,
          mediaType: "text/plain",
          provenance: toolName,
          content: body,
        });
        artifactId = artifact.id;
        replacement = {
          content: [
            {
              type: "text",
              text: artifactReference({
                toolName,
                artifactId: artifact.id,
                byteSize: artifact.byteSize,
                tokenEstimate: artifact.tokenEstimate,
                preview: artifact.preview,
              }),
            },
          ],
        };
      }

      const reserved = pending.get(event.toolCallId);
      if (reserved) {
        pending.delete(event.toolCallId);
        const failed = (event as { isError?: boolean }).isError === true;
        if (failed) {
          store.failOperation(reserved.key, body.slice(0, 400));
        } else {
          store.commitOperation(reserved.key, {
            result: { bytes: byteSize },
            resultArtifactId: artifactId,
            externalState: "recorded",
          });
        }
      }

      return replacement;
    });
  };
}
