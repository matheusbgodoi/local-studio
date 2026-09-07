// The personal MCP connectors: registered in <userData>/connectors.json, but
// NEVER active in a fresh agent session.
//
// A connector listed here is *session-gated*: its tool schemas are not put on
// the wire until the user types `/mcp <alias>` in that session, and its stdio
// process is not spawned until then either. Everything else in connectors.json
// (Google Workspace bindings, plugin connectors, ad-hoc servers) keeps the old
// eager behaviour — see connectors-service.ts.
//
// Shared so the composer command and the agent runtime agree on one table.

export type PersonalConnector = {
  /** What the user types: `/mcp media`. */
  alias: string;
  /** Connector id in connectors.json. */
  connectorId: string;
  label: string;
  description: string;
};

export const PERSONAL_CONNECTORS: readonly PersonalConnector[] = [
  {
    alias: "media",
    connectorId: "personal-media-mcp",
    label: "Media",
    description: "Local audio/video digestion (transcripts, frames)",
  },
  {
    alias: "knowledge",
    connectorId: "personal-knowledge-mcp",
    label: "Knowledge",
    description: "Private personal knowledge retrieval",
  },
  {
    alias: "scimath",
    connectorId: "scimath-mcp",
    label: "SciMath",
    description: "Exact arithmetic, units, statistics, symbolic math",
  },
  {
    alias: "photo",
    connectorId: "local-photo",
    label: "Photo",
    description: "Local Photo AI image generation and upscaling",
  },
  {
    alias: "pinterest",
    connectorId: "personal-pinterest-mcp",
    label: "Pinterest",
    description: "Visual inspiration search ranked by personal style",
  },
] as const;

const byAlias = new Map(PERSONAL_CONNECTORS.map((entry) => [entry.alias, entry]));
const byConnectorId = new Map(PERSONAL_CONNECTORS.map((entry) => [entry.connectorId, entry]));

export function isPersonalConnectorId(connectorId: string): boolean {
  return byConnectorId.has(connectorId);
}

/** Resolve what the user typed — alias, connector id, or label — to one entry. */
export function resolvePersonalConnector(token: string): PersonalConnector | null {
  const key = token.trim().toLowerCase();
  if (!key) return null;
  return (
    byAlias.get(key) ??
    byConnectorId.get(key) ??
    PERSONAL_CONNECTORS.find((entry) => entry.label.toLowerCase() === key) ??
    null
  );
}

/** Keep only ids that name a personal connector, de-duplicated, order stable. */
export function normalizePersonalConnectorIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (!isPersonalConnectorId(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
