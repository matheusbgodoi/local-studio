// Per-agent-session activation of personal MCP connectors.
//
// The choke point is agent.state.tools: whatever is not there is never
// serialised into the request (pi dist/core/agent-session.js
// setActiveToolsByName). This module drives that choke point WITHOUT touching
// connectors.json and WITHOUT participating in runtimeOptionsFingerprint, so
// activation never tears down a runtime or re-spawns an MCP client.
//
// Shape of the mechanism:
//   * an inline extension (like createGoalPromptExtension) registers NOTHING at
//     load, it only hands the live ExtensionAPI back to the runtime session;
//   * `/mcp <name>` inventories that one connector — the first spawn of its
//     process — and pi.registerTool()s its tools. registerTool calls
//     runtime.refreshTools(), which auto-activates tools that were not in the
//     previous registry, so the schemas reach the very next turn;
//   * `/mcp off <name>` drops those names from the active set (later turns carry
//     zero schemas for it) and closes the pooled connection when no other
//     session still holds the connector.
//
// Skills and MCPs stay distinct: a skill is instructions for one task, an MCP is
// a tool capability for a session.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callConnectorTool, listConnectorTools } from "./connector-pool";
import { registeredPersonalConnectors } from "./connectors-service";
import { normalizePersonalConnectorIds } from "../../../shared/agent/personal-connectors";
import { getGlobalSingleton } from "./instances";

/** Same qualification the RPC connectors bridge uses, so a tool name means the
 *  same thing whichever side registered it. */
export function qualifiedConnectorToolName(connectorId: string, tool: string): string {
  return `${connectorId.replace(/-/g, "_")}_${tool.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/** Active tool names after activating `add` and deactivating `remove`.
 *  Additive and order-stable: existing tools keep their position. */
export function nextActiveToolNames(
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const dropped = new Set(remove);
  const kept = current.filter((name) => !dropped.has(name));
  const seen = new Set(kept);
  for (const name of add) {
    if (dropped.has(name) || seen.has(name)) continue;
    seen.add(name);
    kept.push(name);
  }
  return kept;
}

/** The choke point, narrowed: agent.state.tools is only reachable through these
 *  two calls, so activation/deactivation is expressible against a fake in tests
 *  and against the real Pi session at runtime. */
export type ToolActivationTarget = {
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
};

/** Add these tool names to the active set. Additive: everything already active
 *  stays active, so activating a second connector never drops the first. */
export function activateConnectorTools(
  target: ToolActivationTarget,
  toolNames: readonly string[],
): void {
  if (toolNames.length === 0) return;
  target.setActiveToolsByName(nextActiveToolNames(target.getActiveToolNames(), toolNames, []));
}

/** Remove these tool names from the active set. Later turns carry no schema for
 *  them; the definitions stay in the registry so re-activation is free. */
export function deactivateConnectorTools(
  target: ToolActivationTarget,
  toolNames: readonly string[],
): void {
  if (toolNames.length === 0) return;
  target.setActiveToolsByName(nextActiveToolNames(target.getActiveToolNames(), [], toolNames));
}

export type ConnectorSelectionPlan = {
  activate: string[];
  deactivate: string[];
};

/** Diff a desired connector set against what this session already holds. */
export function planConnectorSelection(
  active: Iterable<string>,
  desired: readonly string[],
): ConnectorSelectionPlan {
  const activeSet = new Set(active);
  const desiredSet = new Set(normalizePersonalConnectorIds(desired));
  return {
    activate: [...desiredSet].filter((id) => !activeSet.has(id)),
    deactivate: [...activeSet].filter((id) => !desiredSet.has(id)),
  };
}

// --- cross-session accounting -----------------------------------------------
// connectorId -> runtime session ids currently holding it. A pooled connection
// is only closed when the last holder lets go.

type Holders = Map<string, Set<string>>;

function holders(): Holders {
  return getGlobalSingleton("personalConnectorHolders", () => new Map<string, Set<string>>());
}

export function holdConnector(connectorId: string, sessionKey: string): void {
  const map = holders();
  const set = map.get(connectorId) ?? new Set<string>();
  set.add(sessionKey);
  map.set(connectorId, set);
}

/** Release one holder. Returns true when nothing else needs the connector. */
export function releaseConnector(connectorId: string, sessionKey: string): boolean {
  const map = holders();
  const set = map.get(connectorId);
  if (!set) return true;
  set.delete(sessionKey);
  if (set.size > 0) return false;
  map.delete(connectorId);
  return true;
}

// --- the inline pi extension -------------------------------------------------

/**
 * An extension that registers nothing. Its only job is to hand the live
 * ExtensionAPI to the runtime session so tools can be registered later, on the
 * turn the user actually asks for them.
 */
export function createConnectorToolsExtension(onReady: (pi: ExtensionAPI) => void) {
  return (pi: ExtensionAPI): void => {
    onReady(pi);
  };
}

type ToolSchema = Parameters<ExtensionAPI["registerTool"]>[0]["parameters"];

type ConnectorToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: { connectorId: string; tool: string; failed?: boolean; error?: string };
};

/** TypeBox's `Type.Unsafe(schema)` is `{ ...schema, "~unsafe": null }`; MCP tools
 *  carry their own JSON Schema, so pass it through untyped exactly like the RPC
 *  bridge does — without pulling typebox into this package. */
function unsafeSchema(schema: Record<string, unknown> | undefined): ToolSchema {
  const base = schema ?? { type: "object", properties: {} };
  return { ...base, "~unsafe": null } as unknown as ToolSchema;
}

function renderMcpResult(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) => (block.type === "text" && block.text ? block.text : JSON.stringify(block)))
      .join("\n");
    return text || "(empty result)";
  }
  return JSON.stringify(result ?? null);
}

/**
 * Inventory one connector (spawning it if needed) and register its tools on the
 * live session. Returns the qualified tool names that were registered.
 */
export async function registerConnectorTools(
  pi: ExtensionAPI,
  connectorId: string,
  label: string,
): Promise<string[]> {
  const tools = await listConnectorTools(connectorId);
  const names: string[] = [];
  for (const tool of tools) {
    const name = qualifiedConnectorToolName(connectorId, tool.name);
    names.push(name);
    pi.registerTool({
      name,
      label: `${label}: ${tool.name}`,
      description: tool.description || `${tool.name} via the ${label} connector`,
      parameters: unsafeSchema(tool.inputSchema as Record<string, unknown> | undefined),
      async execute(_id, params): Promise<ConnectorToolResult> {
        try {
          const result = await callConnectorTool(
            connectorId,
            tool.name,
            (params ?? {}) as Record<string, unknown>,
          );
          return {
            content: [{ type: "text", text: renderMcpResult(result) }],
            details: { connectorId, tool: tool.name },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `${connectorId}/${tool.name} failed: ${message}` }],
            details: { connectorId, tool: tool.name, failed: true, error: message },
          };
        }
      },
    });
  }
  return names;
}

/** Personal connectors actually present and enabled in connectors.json. */
export async function activatableConnectorIds(): Promise<string[]> {
  return (await registeredPersonalConnectors()).map((connector) => connector.id);
}
