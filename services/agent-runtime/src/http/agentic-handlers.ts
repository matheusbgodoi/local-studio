//
// HTTP surface for the durable agentic runtime. Creating a Run answers
// immediately with its id — the scheduler loop owns every turn from there, so
// nothing about a Run's progress depends on a request staying open.
//

import { agenticRuntime } from "../agentic/service";
import { resolveAllowedWorkspace } from "../projects-store";
import type { AcceptanceCriterion } from "../agentic/contract";
import type { TaskSeed } from "../agentic/store";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const ACCEPTANCE_KINDS = ["command", "file", "artifact", "review", "assertion"] as const;

//
// The kind reaches the owner-facing view through a schema that only accepts
// these five. Casting an arbitrary string here made one bad request break the
// decoding of every snapshot for that Run, permanently.
//
const asKind = (value: unknown): AcceptanceCriterion["kind"] => {
  const raw = asString(value);
  return (ACCEPTANCE_KINDS as readonly string[]).includes(raw)
    ? (raw as AcceptanceCriterion["kind"])
    : "assertion";
};

const goalCriterion = (): AcceptanceCriterion => ({
  id: "goal",
  description: "The stated goal is achieved, with observable evidence",
  kind: "assertion",
  satisfied: false,
  evidence: null,
});

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
        kind: asKind(record.kind),
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
    //
    // A task with no criteria would have nothing to prove and nothing to
    // reject, so a caller that supplies none gets the goal criterion rather
    // than a task the runtime can only fail.
    //
    const acceptance = asCriteria(record.acceptance, index + 1);
    return [
      {
        title,
        description: asString(record.description) || title,
        dependencies: Array.isArray(record.dependencies)
          ? record.dependencies.map(asString).filter(Boolean)
          : [],
        acceptance: acceptance.length > 0 ? acceptance : [goalCriterion()],
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

export async function handleAgenticCurrentRun(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const sessionId = asString(params.get("sessionId"));
  const piSessionId = asString(params.get("piSessionId"));
  if (!sessionId && !piSessionId) {
    return jsonError("sessionId or piSessionId is required.");
  }
  try {
    return Response.json({
      run: agenticRuntime().currentRunForConversation(sessionId, piSessionId || null),
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to resolve the conversation Run."), 500);
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
  const requestedCwd = asString(body?.cwd);
  if (!goal || !modelId || !requestedCwd) {
    return jsonError("Body must include goal, modelId and cwd.");
  }
  //
  // Every other route that takes a working directory confines it to
  // WORKSPACE_ROOTS. A Run drives tools with full access, so this one is the
  // last place that should have been the exception.
  //
  let cwd: string;
  try {
    cwd = resolveAllowedWorkspace(requestedCwd);
  } catch (error) {
    return jsonError(errorMessage(error, "cwd is outside the allowed workspace roots."), 403);
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
            acceptance: [goalCriterion()],
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
    const result = await agenticRuntime().cancelRun(runId);
    return Response.json(
      { ok: true, ...result },
      { status: result.cancellationPending ? 202 : 200 },
    );
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to cancel the run."), 500);
  }
}

export async function handleAgenticRunArchive(request: Request, runId: string): Promise<Response> {
  const body = await readJsonBody(request);
  if (typeof body?.archived !== "boolean") {
    return jsonError("Body must include archived as a boolean.");
  }
  try {
    return Response.json({ ok: true, run: agenticRuntime().archiveRun(runId, body.archived) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update the Run archive."), 409);
  }
}

export async function handleAgenticRunDelete(runId: string): Promise<Response> {
  try {
    await agenticRuntime().deleteRun(runId);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to delete the Run."), 409);
  }
}

const MAX_ARTIFACT_SLICE = 200_000;

export async function handleAgenticArtifact(
  request: Request,
  artifactId: string,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const length = Math.min(
    MAX_ARTIFACT_SLICE,
    Math.max(1, Number(params.get("length") ?? 4_000) || 4_000),
  );
  try {
    const content = agenticRuntime().readArtifact(artifactId, offset, length);
    if (content === null) return jsonError("Unknown artifact.", 404);
    return Response.json({ artifactId, offset, length, content });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read the artifact."), 500);
  }
}
