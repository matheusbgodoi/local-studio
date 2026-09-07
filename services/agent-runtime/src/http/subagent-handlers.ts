import { Schema } from "effect";
import { readJsonRequestWithinLimit } from "../../../../shared/agent/agent-turn-body";
import {
  SUBAGENT_BODY_LIMIT_BYTES,
  SubagentRunInputSchema,
} from "../../../../shared/agent/subagent";
import { listSubagents, runSubagent } from "../subagents";
import { errorMessage, jsonError } from "./helpers";

const decodeRun = Schema.decodeUnknownOption(SubagentRunInputSchema);

export async function handleSubagentsList(request: Request): Promise<Response> {
  const parent = new URL(request.url).searchParams.get("piSessionId")?.trim();
  if (!parent) return jsonError("piSessionId is required.");
  return Response.json({ subagents: listSubagents(parent) });
}

export async function handleSubagentRun(request: Request): Promise<Response> {
  const body = await readJsonRequestWithinLimit(request, SUBAGENT_BODY_LIMIT_BYTES);
  if (!body.ok) return jsonError(body.error, body.status);
  const decoded = decodeRun(body.value);
  if (decoded._tag === "None" || !decoded.value.parentPiSessionId.trim() || !decoded.value.task.trim()) {
    return jsonError("Body must include parentPiSessionId, name and task.");
  }
  try {
    const result = await runSubagent(decoded.value, request.signal);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(errorMessage(error, "Subagent run failed."), request.signal.aborted ? 499 : 500);
  }
}
