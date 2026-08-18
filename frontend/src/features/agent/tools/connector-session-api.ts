// Client for per-session personal MCP activation.
//
// The route proxies to the agent runtime, which owns piRuntimeManager and the
// live Pi tool set. Nothing here writes connectors.json.

const ENDPOINT = "/api/agent/connectors/session";

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; errors?: Record<string, string> };
    if (payload.error) return payload.error;
    const entries = Object.entries(payload.errors ?? {});
    if (entries.length > 0) {
      return entries.map(([id, message]) => `${id}: ${message}`).join("; ");
    }
  } catch {
    // fall through to the status line
  }
  return `Connector request failed (${response.status})`;
}

export async function setSessionConnectors(
  sessionId: string,
  connectorIds: string[],
): Promise<{ active: string[]; error: string | null }> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, connectors: connectorIds }),
    });
  } catch (error) {
    return {
      active: [],
      error: error instanceof Error ? error.message : "Connector request failed",
    };
  }
  if (!response.ok) return { active: [], error: await readError(response) };
  const payload = (await response.json()) as { active?: string[] };
  return { active: payload.active ?? [], error: null };
}
