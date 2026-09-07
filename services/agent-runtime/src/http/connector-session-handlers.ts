//
// HTTP surface for per-session personal MCP activation. Lives here (not in
// Next) because piRuntimeManager — and therefore agent.state.tools, the only
// place tool schemas are serialised from — lives in the agent-runtime process.
//
// Activation never writes connectors.json, never enters runtimeFingerprint, and
// never touches the model, thinking level, or any global default.
//

import { piRuntimeManager } from "../pi-runtime";
import { registeredPersonalConnectors } from "../connectors-service";
import { normalizePersonalConnectorIds } from "../../../../shared/agent/personal-connectors";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

async function registeredIds(): Promise<string[]> {
  return (await registeredPersonalConnectors()).map((connector) => connector.id);
}

export async function handleConnectorSessionGet(request: Request): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim() ?? "";
  try {
    const resolved = sessionId ? piRuntimeManager.findSessionForLookup(sessionId, null) : null;
    return Response.json({
      registered: await registeredIds(),
      active: resolved?.session.getConnectorSelection() ?? [],
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read connector selection."), 500);
  }
}

export async function handleConnectorSessionPut(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) return jsonError("sessionId is required.");
  const requested = Array.isArray(body.connectors)
    ? body.connectors.filter((entry): entry is string => typeof entry === "string")
    : [];
  const connectors = normalizePersonalConnectorIds(requested);
  try {
    const registered = await registeredIds();
    const missing = connectors.filter((id) => !registered.includes(id));
    if (missing.length > 0) {
      return Response.json(
        { error: `Not registered or not enabled: ${missing.join(", ")}`, registered },
        { status: 404 },
      );
    }
    // getSession, not findSessionForLookup: a connector may be armed before the
    // session's first turn, and the selection is applied when it starts.
    const result = await piRuntimeManager.getSession(sessionId).setConnectorSelection(connectors);
    return Response.json(
      { registered, active: result.pending, live: result.active, errors: result.errors },
      { status: Object.keys(result.errors).length > 0 ? 502 : 200 },
    );
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to apply connector selection."), 500);
  }
}
