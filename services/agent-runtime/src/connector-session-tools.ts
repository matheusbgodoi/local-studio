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
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  details: {
    connectorId: string;
    tool: string;
    failed?: boolean;
    error?: string;
    generatedImages?: Array<{ filename: string; subfolder: string }>;
  };
};

/** TypeBox's `Type.Unsafe(schema)` is `{ ...schema, "~unsafe": null }`; MCP tools
 *  carry their own JSON Schema, so pass it through untyped exactly like the RPC
 *  bridge does — without pulling typebox into this package. */
function unsafeSchema(schema: Record<string, unknown> | undefined): ToolSchema {
  const base = schema ?? { type: "object", properties: {} };
  return { ...base, "~unsafe": null } as unknown as ToolSchema;
}

type McpResultRecord = {
  content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }>;
  structuredContent?: unknown;
};

type GeneratedImageRef = { filename: string; subfolder: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inlineImage(text: string): { type: "image"; data: string; mimeType: string } | null {
  const match = /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(text.trim());
  if (!match?.[1] || !match[2]) return null;
  return { type: "image", data: match[2], mimeType: match[1] };
}

function connectorContent(result: unknown): ConnectorToolResult["content"] {
  const content = (result as McpResultRecord | null)?.content;
  if (!Array.isArray(content)) {
    return [{ type: "text", text: JSON.stringify(result ?? null) }];
  }
  const blocks = content.flatMap((block): ConnectorToolResult["content"] => {
    if (block.type === "image" && block.data && block.mimeType?.startsWith("image/")) {
      return [{ type: "image", data: block.data, mimeType: block.mimeType }];
    }
    if (block.type !== "text" || !block.text) return [];
    const image = inlineImage(block.text);
    return image ? [image] : [{ type: "text", text: block.text }];
  });
  return blocks.length > 0 ? blocks : [{ type: "text", text: "(empty result)" }];
}

function generatedImageRefs(result: unknown): GeneratedImageRef[] {
  const source = result as McpResultRecord | null;
  const candidates: unknown[] = [source?.structuredContent];
  for (const block of source?.content ?? []) {
    if (block.type !== "text" || !block.text) continue;
    try {
      candidates.push(JSON.parse(block.text) as unknown);
    } catch {
      continue;
    }
  }
  const refs: GeneratedImageRef[] = [];
  for (const candidate of candidates) {
    const payload = record(candidate);
    const outputs = Array.isArray(payload?.outputs) ? payload.outputs : [];
    for (const output of outputs) {
      const item = record(output);
      if (typeof item?.filename !== "string" || !item.filename.trim()) continue;
      refs.push({
        filename: item.filename.trim(),
        subfolder: typeof item.subfolder === "string" ? item.subfolder : "",
      });
    }
  }
  return refs.filter(
    (item, index) =>
      refs.findIndex(
        (candidate) =>
          candidate.filename === item.filename && candidate.subfolder === item.subfolder,
      ) === index,
  );
}

function returnsGeneratedImages(tool: string): boolean {
  return /(?:run_workflow(?:_stream)?|generate_image|transform_image|inpaint_image|upscale_image)$/.test(
    tool,
  );
}

async function generatedImageContent(
  connectorId: string,
  tool: string,
  result: unknown,
): Promise<{ images: ConnectorToolResult["content"]; refs: GeneratedImageRef[] }> {
  if (!returnsGeneratedImages(tool)) return { images: [], refs: [] };
  const refs = generatedImageRefs(result);
  const images: ConnectorToolResult["content"] = [];
  for (const output of refs.slice(0, 4)) {
    try {
      const fetched = await callConnectorTool(connectorId, "comfyui_get_image", {
        filename: output.filename,
        subfolder: output.subfolder,
        response_format: "data_uri",
        preview_format: "webp",
        preview_quality: 90,
      });
      images.push(...connectorContent(fetched).filter((block) => block.type === "image"));
    } catch {
      continue;
    }
  }
  return { images, refs };
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
          const generated = await generatedImageContent(connectorId, tool.name, result);
          return {
            content: [...connectorContent(result), ...generated.images],
            details: {
              connectorId,
              tool: tool.name,
              ...(generated.refs.length > 0 ? { generatedImages: generated.refs } : {}),
            },
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
