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

//
// The runtime's own tools are exempt. Externalising the output of
// read_agentic_artifact would store the artifact again and hand back a pointer
// to a pointer, so a large artifact could never be read.
//
export const CONTROL_TOOL_NAMES = [
  "plan_agentic_run",
  "revise_agentic_plan",
  "report_task_progress",
  "read_agentic_artifact",
] as const;

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

const UNASSIGNED_TASK = "unassigned";

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
      try {
        return reserveFor(event);
      } catch {
        //
        // The SDK turns a throw in this hook into a blocked tool. A bookkeeping
        // failure must never stop work the model was allowed to do.
        //
        return;
      }
    });

    const reserveFor = (event: unknown) => {
      const store = deps.store();
      const run = deps.activeRun();
      if (!store || !run) return;
      const toolName = (event as { toolName?: string }).toolName ?? "";
      if ((CONTROL_TOOL_NAMES as readonly string[]).includes(toolName)) return;
      if (!policy.sideEffectingTools.includes(toolName)) return;
      //
      // Between planning and the first launch there is no active task, and a
      // side effect there still has to be recoverable.
      //
      const taskId = run.activeTaskId ?? UNASSIGNED_TASK;

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
      pending.set((event as { toolCallId: string }).toolCallId, { key, runId: run.id, taskId });
      if (reservation.operation.status === "COMMITTED") {
        store.appendEvent({
          runId: run.id,
          taskId,
          type: "OPERATION_REPEATED",
          summary: `${toolName} ran again with identical arguments`,
        });
      }
      return;
    };

    pi.on("tool_result", (event) => {
      try {
        return externaliseAndSettle(event);
      } catch {
        return;
      }
    });

    const externaliseAndSettle = (event: {
      toolCallId: string;
      toolName?: string;
      content?: { type?: string; text?: string }[];
      isError?: boolean;
    }) => {
      const store = deps.store();
      if (!store) return;
      const toolName = event.toolName ?? "tool";
      if ((CONTROL_TOOL_NAMES as readonly string[]).includes(toolName)) return;

      //
      // Settle the ledger first. A Run that finished between the call and its
      // result would otherwise leave the operation STARTED for good.
      //
      const reserved = pending.get(event.toolCallId);
      const content = event.content ?? [];
      const body = textOf(content);
      const byteSize = Buffer.byteLength(body, "utf8");
      const run = deps.activeRun();
      const oversized = Boolean(run) && byteSize > policy.previewBudgetBytes;

      let artifactId: string | null = null;
      let replacement: { content: { type: "text"; text: string }[] } | undefined;

      if (oversized && run) {
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
        //
        // Only the text is replaced. An image block a tool returned is not the
        // thing that blew the budget, and dropping it would silently lose it.
        //
        const keptBlocks = content.filter((block) => block.type !== "text");
        replacement = {
          content: [
            {
              type: "text" as const,
              text: artifactReference({
                toolName,
                artifactId: artifact.id,
                byteSize: artifact.byteSize,
                tokenEstimate: artifact.tokenEstimate,
                preview: artifact.preview,
              }),
            },
            ...(keptBlocks as { type: "text"; text: string }[]),
          ],
        };
      }

      if (reserved) {
        pending.delete(event.toolCallId);
        const failed = event.isError === true;
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
    };
  };
}
