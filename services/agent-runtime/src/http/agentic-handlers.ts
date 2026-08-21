//
// HTTP surface for the durable agentic runtime. Creating a Run answers
// immediately with its id — the scheduler loop owns every turn from there, so
// nothing about a Run's progress depends on a request staying open.
//

import { agenticRuntime } from "../agentic/service";
import type { AcceptanceCriterion } from "../agentic/contract";
import type { TaskSeed } from "../agentic/store";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const asCriteria = (value: unknown, taskIndex: number): AcceptanceCriterion[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry === "string") {
      return [
        {
          id: `t${taskIndex}c${index + 1}`,
          description: entry,
          kind: "assertion" as const,
          satisfied: false,
          evidence: null,
        },
      ];
    }
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const description = asString(record.description);
    if (!description) return [];
    return [
      {
        id: asString(record.id) || `t${taskIndex}c${index + 1}`,
        description,
        kind: (asString(record.kind) || "assertion") as AcceptanceCriterion["kind"],
        satisfied: false,
        evidence: null,
      },
    ];
  });
};

const asTasks = (value: unknown): TaskSeed[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const title = asString(record.title);
    if (!title) return [];
    return [
      {
        title,
        description: asString(record.description) || title,
        dependencies: Array.isArray(record.dependencies)
          ? record.dependencies.map(asString).filter(Boolean)
          : [],
        acceptance: asCriteria(record.acceptance, index + 1),
      },
    ];
  });
};

export async function handleAgenticRunsList(): Promise<Response> {
  try {
    return Response.json({ runs: agenticRuntime().listRuns() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list runs."), 500);
  }
}

export async function handleAgenticRunGet(runId: string): Promise<Response> {
  try {
    return Response.json(agenticRuntime().snapshot(runId));
  } catch (error) {
    return jsonError(errorMessage(error, "Unknown run."), 404);
  }
}

export async function handleAgenticRunCreate(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const goal = asString(body?.goal);
  const modelId = asString(body?.modelId);
  const cwd = asString(body?.cwd);
  if (!goal || !modelId || !cwd) {
    return jsonError("Body must include goal, modelId and cwd.");
  }
  const tasks = asTasks(body?.tasks);
  const plan: TaskSeed[] =
    tasks.length > 0
      ? tasks
      : [
          {
            title: goal.slice(0, 120),
            description: goal,
            dependencies: [],
            acceptance: [
              {
                id: "goal",
                description: "The stated goal is achieved, with observable evidence",
                kind: "assertion",
                satisfied: false,
                evidence: null,
              },
            ],
          },
        ];
  try {
    const run = await agenticRuntime().startRun({
      goal,
      modelId,
      cwd,
      sessionId: asString(body?.sessionId) || "default",
      piSessionId: asString(body?.piSessionId) || null,
      tasks: plan,
      ...(asString(body?.agentName) ? { agentName: asString(body?.agentName) } : {}),
    });
    return Response.json({ ok: true, run });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to start the run."), 500);
  }
}

export async function handleAgenticRunResume(runId: string): Promise<Response> {
  try {
    return Response.json({ ok: true, run: await agenticRuntime().resumeRun(runId) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to resume the run."), 500);
  }
}

export async function handleAgenticRunCancel(runId: string): Promise<Response> {
  try {
    return Response.json({ ok: true, run: agenticRuntime().cancelRun(runId) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to cancel the run."), 500);
  }
}

const MAX_ARTIFACT_SLICE = 200_000;

export async function handleAgenticArtifact(request: Request, artifactId: string): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const length = Math.min(MAX_ARTIFACT_SLICE, Math.max(1, Number(params.get("length") ?? 4_000) || 4_000));
  try {
    const content = agenticRuntime().readArtifact(artifactId, offset, length);
    if (content === null) return jsonError("Unknown artifact.", 404);
    return Response.json({ artifactId, offset, length, content });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read the artifact."), 500);
  }
}
