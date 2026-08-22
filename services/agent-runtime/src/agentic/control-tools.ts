//
// The tool surface the served model drives the runtime through.
//
// Small on purpose. Four tools cover every structural transition, and each one
// is a proposal the runtime validates before anything is persisted. There is
// no tool that writes a row, sets a status or invents an id: those stay the
// runtime's, which is what keeps a confused or adversarial model unable to
// corrupt a Run.
//
// Routing is native tool-calling, not a keyword classifier. The model is told
// the rule in the system prompt and decides for itself whether a request is a
// question or a piece of durable work.
//

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agenticControlHost } from "./control-host";
import { validateProgress, validateProposal } from "./control-plane";

type ToolSchema = Parameters<ExtensionAPI["registerTool"]>[0]["parameters"];

// TypeBox's Type.Unsafe(schema) is `{ ...schema, "~unsafe": null }`. Passing
// JSON Schema through this way is what connector-session-tools already does,
// and it keeps typebox out of this package.
const schema = (value: Record<string, unknown>): ToolSchema =>
  ({ ...value, "~unsafe": null }) as unknown as ToolSchema;

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }], details: {} });

const TASK_ITEM = {
  type: "object",
  required: ["title", "acceptance"],
  properties: {
    title: { type: "string", description: "Short unique name for this task" },
    description: { type: "string", description: "What doing this task involves" },
    dependsOn: {
      type: "array",
      items: { type: "string" },
      description: "Titles of tasks in this same plan that must finish first",
    },
    acceptance: {
      type: "array",
      items: { type: "string" },
      description:
        "What observable evidence would prove this task done. One entry per check, stated so it can be verified by running something.",
    },
  },
} as const;

const AGENT_ITEM = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", description: "Short name, e.g. Backend" },
    role: { type: "string", description: "What this agent is for" },
    tasks: {
      type: "array",
      items: { type: "string" },
      description: "Titles of the tasks this agent owns",
    },
  },
} as const;

export const AGENTIC_ROUTING_INSTRUCTIONS = [
  "Durable work runtime:",
  "- When a request is substantial multi-step work that should survive this conversation — building, refactoring, migrating, investigating across many steps — call `plan_agentic_run` FIRST, with a plan, and then carry it out.",
  "- When a request is a question, an explanation, a lookup or a single small edit, just answer. Do NOT create a run for it.",
  "- Inside a run, report through `report_task_progress` rather than by describing progress in prose. State the evidence that proves each acceptance criterion — the command you ran and what it printed.",
  "- A task is finished when its acceptance criteria are met, not when you feel done. The runtime enforces that.",
  "- If the approach is not working, call `revise_agentic_plan` with what you learned instead of repeating the same attempt.",
].join("\n");

export function createAgenticControlExtension(getSessionId: () => string | null) {
  return (pi: ExtensionAPI): void => {
    //
    // The rule reaches the model as part of its system prompt, so the decision
    // is native tool-calling rather than a classifier bolted on the outside.
    //
    pi.on("before_agent_start", (event) => {
      if (event.systemPrompt.includes("Durable work runtime:")) return {};
      return { systemPrompt: `${event.systemPrompt.trimEnd()}\n\n${AGENTIC_ROUTING_INSTRUCTIONS}` };
    });

    pi.registerTool({
      name: "plan_agentic_run",
      label: "Plan a durable run",
      description:
        "Start a durable, resumable Run for substantial multi-step work. Propose the goal and a coarse plan: tasks, what each depends on, and the observable evidence that would prove each one done. Optionally name logical agents when the work has independent strands. Do not use this for questions, explanations or single small edits.",
      promptSnippet: "plan_agentic_run — start a durable run for substantial multi-step work",
      promptGuidelines: [
        "Create a run only for work that spans many steps and should survive a compaction or a restart.",
        "Keep the plan coarse: a handful of tasks, each with evidence that could be checked by running something.",
      ],
      parameters: schema({
        type: "object",
        required: ["goal", "tasks"],
        properties: {
          goal: { type: "string", description: "What the owner asked for, in one or two sentences" },
          tasks: { type: "array", items: TASK_ITEM },
          agents: { type: "array", items: AGENT_ITEM },
        },
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const host = agenticControlHost();
        if (!host) return text("The durable runtime is unavailable; continue without a run.");
        const sessionId = getSessionId();
        if (!sessionId) return text("This session has no id yet; continue without a run.");

        const existing = host.activeRunForSession(sessionId);
        if (existing) {
          return text(
            `This conversation is already driving run ${existing.id}. Use revise_agentic_plan to change the plan.`,
          );
        }

        const validated = validateProposal(params);
        if (!validated.ok) return text(`The plan was rejected: ${validated.reason}. Propose a corrected plan.`);

        const modelId = ctx.model?.id;
        if (!modelId) return text("No model is selected; continue without a run.");

        const started = await host.startRun({
          plan: validated,
          modelId,
          sessionId,
          piSessionId: ctx.sessionManager.getSessionId() ?? null,
          cwd: ctx.cwd,
        });
        const lines = started.tasks.map(
          (task) =>
            `  ${task.id}  ${task.title}  [${task.acceptance.map((criterion) => criterion.id).join(", ")}]`,
        );
        return text(
          [
            `Run ${started.run.id} created with ${started.tasks.length} task(s) and agent(s): ${started.agentNames.join(", ")}.`,
            "Task ids and their acceptance criterion ids:",
            ...lines,
            "The runtime will keep this run moving across compactions and restarts. Report with report_task_progress as you go.",
          ].join("\n"),
        );
      },
    });

    pi.registerTool({
      name: "revise_agentic_plan",
      label: "Revise the plan",
      description:
        "Replace the plan of the run this conversation is driving. Use this when what you learned means the current plan cannot work — split a task, add a diagnostic step, reorder dependencies. Tasks carried across by the same title keep their status and evidence.",
      promptSnippet: "revise_agentic_plan — replace the current run's plan when the approach must change",
      parameters: schema({
        type: "object",
        required: ["reason", "tasks"],
        properties: {
          reason: { type: "string", description: "What you learned that makes the plan wrong" },
          tasks: { type: "array", items: TASK_ITEM },
          agents: { type: "array", items: AGENT_ITEM },
        },
      }),
      async execute(_id, params) {
        const host = agenticControlHost();
        const sessionId = getSessionId();
        const run = host && sessionId ? host.activeRunForSession(sessionId) : null;
        if (!host || !run) return text("This conversation is not driving a run.");

        const record = (params ?? {}) as Record<string, unknown>;
        const validated = validateProposal({ goal: run.goal, tasks: record.tasks, agents: record.agents });
        if (!validated.ok) return text(`The revision was rejected: ${validated.reason}.`);

        const reason = typeof record.reason === "string" ? record.reason.trim() : "";
        const revised = host.revisePlan({ runId: run.id, reason: reason || "the approach changed", plan: validated });
        return text(
          [
            `Plan revised to revision ${revised.run.planRevision}.`,
            ...revised.tasks.map((task) => `  ${task.id}  ${task.title}  ${task.status}`),
          ].join("\n"),
        );
      },
    });

    pi.registerTool({
      name: "report_task_progress",
      label: "Report task progress",
      description:
        "Report progress on a task of the run this conversation is driving. Supply the evidence that proves each acceptance criterion — the command you ran and what it printed. Say complete only when you believe every criterion is met; the runtime checks. Use blocked when you cannot proceed, and needsUser only when a human decision, credential or permission is genuinely required.",
      promptSnippet: "report_task_progress — record evidence against a task's acceptance criteria",
      parameters: schema({
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string", description: "The task id the runtime gave you" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              required: ["criterion", "evidence"],
              properties: {
                criterion: { type: "string", description: "The acceptance criterion id" },
                evidence: { type: "string", description: "What proves it — command and output" },
              },
            },
          },
          complete: { type: "boolean", description: "You believe every criterion is now met" },
          blocked: { type: "string", description: "Why you cannot proceed" },
          needsUser: { type: "string", description: "A question only the owner can answer" },
        },
      }),
      async execute(_id, params) {
        const host = agenticControlHost();
        const sessionId = getSessionId();
        const run = host && sessionId ? host.activeRunForSession(sessionId) : null;
        if (!host || !run) return text("This conversation is not driving a run.");

        const record = (params ?? {}) as Record<string, unknown>;
        const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
        if (!taskId) return text("taskId is required.");

        const validated = validateProgress(record);
        if ("ok" in validated && validated.ok === false) return text(`Rejected: ${validated.reason}`);

        const outcome = host.reportProgress({
          runId: run.id,
          taskId,
          report: validated as Exclude<typeof validated, { ok: false }>,
        });
        if (!outcome.ok) return text(`Rejected: ${outcome.reason}`);
        if (outcome.unknownCriteria.length > 0) {
          return text(
            `Recorded, but these criterion ids are not on that task: ${outcome.unknownCriteria.join(", ")}. Outstanding: ${outcome.outstanding.join(", ") || "none"}.`,
          );
        }
        return text(
          outcome.satisfied
            ? "Recorded. Every acceptance criterion on this task is now satisfied."
            : `Recorded. Still outstanding: ${outcome.outstanding.join(", ")}.`,
        );
      },
    });

    pi.registerTool({
      name: "read_agentic_artifact",
      label: "Read a stored artifact",
      description:
        "Read part of a large tool output the runtime stored outside the conversation. Use the artifact id from the reference that replaced the output.",
      promptSnippet: "read_agentic_artifact — read part of a large output the runtime stored",
      parameters: schema({
        type: "object",
        required: ["artifactId"],
        properties: {
          artifactId: { type: "string" },
          offset: { type: "number", description: "Character offset to read from" },
          length: { type: "number", description: "How many characters to read" },
        },
      }),
      async execute(_id, params) {
        const host = agenticControlHost();
        if (!host) return text("The durable runtime is unavailable.");
        const record = (params ?? {}) as Record<string, unknown>;
        const artifactId = typeof record.artifactId === "string" ? record.artifactId.trim() : "";
        const offset = Math.max(0, Number(record.offset) || 0);
        const length = Math.min(40_000, Math.max(1, Number(record.length) || 4_000));
        const slice = host.readArtifact(artifactId, offset, length);
        return text(slice === null ? `No artifact ${artifactId}.` : slice);
      },
    });
  };
}
