// `/mcp` — personal MCP connectors, per agent session.
//
//   /mcp              show Available and Active
//   /mcp <name>       activate for THIS session (additive)
//   /mcp off <name>   deactivate; /mcp off  deactivates all
//
// An MCP is a tool capability for a session — not instructions for a task, which
// is what `/skill:<name>` is for. Activation never changes the model, the
// thinking level, the sampler, or any global default: the runtime only moves
// tool names in and out of the live session's active tool set.

import type { ConnectorCatalogueRow } from "@/features/agent/tools/types";
import type { ComposerCommand, ComposerCommandProvider } from "./command-types";

export type McpCommandRequest =
  | { kind: "list" }
  | { kind: "activate"; connectorId: string }
  | { kind: "deactivate"; connectorId: string }
  | { kind: "deactivate-all" }
  | { kind: "unknown"; token: string };

function findRow(
  rows: readonly ConnectorCatalogueRow[],
  token: string,
): ConnectorCatalogueRow | null {
  const key = token.trim().toLowerCase();
  if (!key) return null;
  return (
    rows.find(
      (row) =>
        row.alias === key ||
        row.connectorId.toLowerCase() === key ||
        row.label.toLowerCase() === key,
    ) ?? null
  );
}

/** Pure parse of the `/mcp` argument string against the registered connectors. */
export function parseMcpCommand(
  args: string,
  rows: readonly ConnectorCatalogueRow[],
): McpCommandRequest {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: "list" };
  const [head, ...rest] = parts;
  if (head.toLowerCase() === "off") {
    if (rest.length === 0) return { kind: "deactivate-all" };
    const row = findRow(rows, rest.join(" "));
    return row
      ? { kind: "deactivate", connectorId: row.connectorId }
      : { kind: "unknown", token: rest.join(" ") };
  }
  const row = findRow(rows, parts.join(" "));
  return row
    ? { kind: "activate", connectorId: row.connectorId }
    : { kind: "unknown", token: parts.join(" ") };
}

/** Next active set for a request. Activation is additive; deactivation removes
 *  only the named connector. Order is stable so the summary reads the same. */
export function nextConnectorSelection(
  active: readonly string[],
  request: McpCommandRequest,
): string[] {
  switch (request.kind) {
    case "activate":
      return active.includes(request.connectorId) ? [...active] : [...active, request.connectorId];
    case "deactivate":
      return active.filter((id) => id !== request.connectorId);
    case "deactivate-all":
      return [];
    default:
      return [...active];
  }
}

/** One line, because it lands in the transcript as an event block. */
export function mcpStatusMessage(
  rows: readonly ConnectorCatalogueRow[],
  active: readonly string[],
): string {
  const byId = new Map(rows.map((row) => [row.connectorId, row]));
  const available = rows.length ? rows.map((row) => row.alias).join(", ") : "none registered";
  const activeLabels = active
    .map((id) => byId.get(id)?.alias ?? id)
    .filter(Boolean)
    .join(", ");
  return `MCP · Available: ${available} · Active in this chat: ${activeLabels || "none"}`;
}

export function mcpCommandProvider(options: {
  connectors: ConnectorCatalogueRow[];
  /** Connector ids active for the focused session. */
  active: string[];
  /** Apply a new active set. Resolves with an error message, or null on success. */
  apply: (connectorIds: string[]) => Promise<string | null>;
  /** Write one line into the transcript (rendered as a neutral event block).
   *  `/mcp` is a status command, so its answer has to be visible. */
  notify: (text: string) => void;
}): ComposerCommandProvider {
  return {
    id: "mcp",
    commands: (): ComposerCommand[] => [
      {
        id: "mcp:root",
        name: "mcp",
        title: "MCP",
        description: "Connectors for this chat — /mcp, /mcp <name>, /mcp off <name>",
        source: "core",
        icon: "command",
        run: async (args) => {
          const request = parseMcpCommand(args, options.connectors);
          if (request.kind === "unknown") {
            options.notify(
              `MCP · Unknown connector "${request.token}" · ${mcpStatusMessage(options.connectors, options.active)}`,
            );
            return { kind: "handled" };
          }
          if (request.kind === "list") {
            options.notify(mcpStatusMessage(options.connectors, options.active));
            return { kind: "handled" };
          }
          const next = nextConnectorSelection(options.active, request);
          const error = await options.apply(next);
          options.notify(error ? `MCP · ${error}` : mcpStatusMessage(options.connectors, next));
          return { kind: "handled" };
        },
      },
    ],
  };
}
