//
// HTTP surface for automations (Scheduled) and thread goals. Proxied through
// the Next server like the other runtime handlers.
//

import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  patchAutomation,
} from "../automations-store";
import { runAutomationNow } from "../automation-scheduler";
import { withAutomationMutationLock } from "../automation-mutation-lock";
import { clearGoal, readGoal, writeGoal, type GoalStatus } from "../goals-store";
import { GOAL_STATUSES } from "../../../../shared/agent/session-goal";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

export async function handleAutomationsList(): Promise<Response> {
  try {
    return Response.json({ automations: await listAutomations() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list automations."), 500);
  }
}

export async function handleAutomationCreate(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = typeof body?.name === "string" ? body.name : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId : "";
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  const requiredConnectorIds = body?.requiredConnectorIds;
  if (!prompt.trim() || !modelId.trim()) {
    return jsonError("Body must include prompt and modelId.");
  }
  if (
    requiredConnectorIds !== undefined &&
    (!Array.isArray(requiredConnectorIds) ||
      requiredConnectorIds.some((entry) => typeof entry !== "string"))
  ) {
    return jsonError("requiredConnectorIds must be an array of connector ids.");
  }
  try {
    const automation = await createAutomation({
      name,
      prompt,
      modelId,
      cwd,
      requiredConnectorIds: requiredConnectorIds ?? [],
      schedule: body?.schedule,
    });
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to create automation."), 500);
  }
}

export async function handleAutomationPatch(request: Request, id: string): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  if (
    body.requiredConnectorIds !== undefined &&
    (!Array.isArray(body.requiredConnectorIds) ||
      body.requiredConnectorIds.some((entry) => typeof entry !== "string"))
  ) {
    return jsonError("requiredConnectorIds must be an array of connector ids.");
  }
  try {
    const automation = await patchAutomation(id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
      ...(typeof body.modelId === "string" ? { modelId: body.modelId } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
      ...(Array.isArray(body.requiredConnectorIds)
        ? { requiredConnectorIds: body.requiredConnectorIds }
        : {}),
      ...(body.status === "active" || body.status === "paused" ? { status: body.status } : {}),
      ...(typeof body.unread === "boolean" ? { unread: body.unread } : {}),
      ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
    });
    if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update automation."), 500);
  }
}

export async function handleAutomationDelete(id: string): Promise<Response> {
  try {
    return await withAutomationMutationLock(id, async () => {
      const automation = await getAutomation(id);
      if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
      if (automation.activeRun) return jsonError("A running automation cannot be deleted.", 409);
      const removed = await deleteAutomation(id);
      if (!removed) return jsonError(`Unknown automation '${id}'.`, 404);
      return Response.json({ ok: true });
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to delete automation."), 500);
  }
}

export async function handleAutomationRun(id: string): Promise<Response> {
  const automation = await getAutomation(id);
  if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
  const completed = await runAutomationNow(id);
  if (!completed) return jsonError("This automation is already running.", 409);
  return Response.json({ ok: true, started: completed !== null });
}

// ─── Goals ────────────────────────────────────────────────────────────────

function goalSessionId(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("piSessionId")?.trim();
  return id || null;
}

export async function handleGoalGet(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  try {
    return Response.json({ goal: await readGoal(piSessionId) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read goal."), 500);
  }
}

export async function handleGoalPut(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  try {
    const goal = await writeGoal(piSessionId, {
      ...(typeof body.objective === "string" ? { objective: body.objective } : {}),
      ...(GOAL_STATUSES.includes(body.status as GoalStatus)
        ? { status: body.status as GoalStatus }
        : {}),
      ...(typeof body.turnBudget === "number" || body.turnBudget === null
        ? { turnBudget: body.turnBudget as number | null }
        : {}),
      ...(body.resetTurns === true ? { turnsUsed: 0 } : {}),
    });
    return Response.json({ goal: goal.objective ? goal : null });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update goal."), 500);
  }
}

export async function handleGoalDelete(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  try {
    await clearGoal(piSessionId);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to clear goal."), 500);
  }
}
