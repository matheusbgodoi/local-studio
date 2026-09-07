// Personal MCP connectors: none active in a fresh session, activation adds tool
// schemas for that session only, deactivation takes them away again.

import { describe, expect, test } from "bun:test";
import {
  activateConnectorTools,
  deactivateConnectorTools,
  holdConnector,
  nextActiveToolNames,
  planConnectorSelection,
  qualifiedConnectorToolName,
  releaseConnector,
  type ToolActivationTarget,
} from "../src/connector-session-tools";
import {
  PERSONAL_CONNECTORS,
  isPersonalConnectorId,
  normalizePersonalConnectorIds,
  resolvePersonalConnector,
} from "../../../shared/agent/personal-connectors";
import {
  mcpCommandProvider,
  mcpStatusMessage,
  nextConnectorSelection,
  parseMcpCommand,
} from "../../../frontend/src/features/agent/composer/mcp-commands";

/** Stand-in for the one place tool schemas are serialised from: whatever is not
 *  in `tools` is never put on the wire. */
function fakeSession(initial: string[]): ToolActivationTarget & { tools: string[] } {
  return {
    tools: [...initial],
    getActiveToolNames() {
      return [...this.tools];
    },
    setActiveToolsByName(names: string[]) {
      this.tools = [...names];
    },
  };
}

const MEDIA = "personal-media-mcp";
const SCIMATH = "scimath-mcp";
const mediaTools = ["media_analyze", "media_transcribe"].map((tool) =>
  qualifiedConnectorToolName(MEDIA, tool),
);
const scimathTools = ["calculate"].map((tool) => qualifiedConnectorToolName(SCIMATH, tool));

describe("personal connector registry", () => {
  test("all five friendly names resolve", () => {
    expect(PERSONAL_CONNECTORS.map((entry) => entry.alias)).toEqual([
      "media",
      "knowledge",
      "scimath",
      "photo",
      "pinterest",
    ]);
    expect(resolvePersonalConnector("media")?.connectorId).toBe(MEDIA);
    expect(resolvePersonalConnector("photo")?.connectorId).toBe("local-photo");
    expect(resolvePersonalConnector("Pinterest")?.connectorId).toBe("personal-pinterest-mcp");
    expect(resolvePersonalConnector(SCIMATH)?.alias).toBe("scimath");
    expect(resolvePersonalConnector("github")).toBeNull();
  });

  test("only personal connectors are session-gated", () => {
    expect(isPersonalConnectorId("local-photo")).toBe(true);
    // A non-personal connector keeps the eager behaviour and is never gated.
    expect(isPersonalConnectorId("github")).toBe(false);
    expect(normalizePersonalConnectorIds([MEDIA, "github", MEDIA])).toEqual([MEDIA]);
  });

  test("tool names are qualified the same way the RPC bridge qualifies them", () => {
    expect(qualifiedConnectorToolName(MEDIA, "media_analyze")).toBe(
      "personal_media_mcp_media_analyze",
    );
  });
});

describe("a fresh session", () => {
  test("has no personal connector and no personal tool schema", () => {
    const session = fakeSession(["read", "bash", "edit", "write"]);
    const plan = planConnectorSelection([], []);
    expect(plan).toEqual({ activate: [], deactivate: [] });
    expect(session.tools.some((name) => name.startsWith("personal_"))).toBe(false);
    expect(mcpStatusMessage([], [])).toContain("Active in this chat: none");
    expect(mcpStatusMessage([], [])).toContain("Available: none registered");
  });
});

describe("activation", () => {
  test("adds that connector's tools and leaves the rest of the set alone", () => {
    const session = fakeSession(["read", "bash"]);
    activateConnectorTools(session, mediaTools);
    expect(session.tools).toEqual(["read", "bash", ...mediaTools]);
  });

  test("is additive across connectors", () => {
    const session = fakeSession(["read"]);
    activateConnectorTools(session, mediaTools);
    activateConnectorTools(session, scimathTools);
    expect(session.tools).toEqual(["read", ...mediaTools, ...scimathTools]);
  });

  test("is idempotent", () => {
    const session = fakeSession(["read"]);
    activateConnectorTools(session, mediaTools);
    activateConnectorTools(session, mediaTools);
    expect(session.tools).toEqual(["read", ...mediaTools]);
  });

  test("plans only the delta, so re-applying the same set is a no-op", () => {
    expect(planConnectorSelection([MEDIA], [MEDIA])).toEqual({ activate: [], deactivate: [] });
    expect(planConnectorSelection([MEDIA], [MEDIA, SCIMATH])).toEqual({
      activate: [SCIMATH],
      deactivate: [],
    });
  });
});

describe("deactivation", () => {
  test("removes that connector's tools from later turns", () => {
    const session = fakeSession(["read"]);
    activateConnectorTools(session, mediaTools);
    activateConnectorTools(session, scimathTools);
    deactivateConnectorTools(session, mediaTools);
    expect(session.tools).toEqual(["read", ...scimathTools]);
    expect(session.tools.some((name) => name.startsWith("personal_media"))).toBe(false);
  });

  test("plans the removal when the desired set drops a connector", () => {
    expect(planConnectorSelection([MEDIA, SCIMATH], [SCIMATH])).toEqual({
      activate: [],
      deactivate: [MEDIA],
    });
    expect(planConnectorSelection([MEDIA], [])).toEqual({ activate: [], deactivate: [MEDIA] });
  });

  test("never touches tools it does not own", () => {
    const session = fakeSession(["read", "bash", ...mediaTools]);
    deactivateConnectorTools(session, mediaTools);
    expect(session.tools).toEqual(["read", "bash"]);
  });

  test("the pooled connection only closes when the last session lets go", () => {
    holdConnector(MEDIA, "session-a");
    holdConnector(MEDIA, "session-b");
    expect(releaseConnector(MEDIA, "session-a")).toBe(false);
    expect(releaseConnector(MEDIA, "session-b")).toBe(true);
    // Releasing something nobody holds is safe.
    expect(releaseConnector(MEDIA, "session-a")).toBe(true);
  });

  test("nextActiveToolNames removes before it adds", () => {
    expect(nextActiveToolNames(["a", "b"], ["b", "c"], ["b"])).toEqual(["a", "c"]);
  });
});

describe("/mcp", () => {
  const rows = PERSONAL_CONNECTORS.map((entry) => ({
    connectorId: entry.connectorId,
    alias: entry.alias,
    label: entry.label,
    description: entry.description,
  }));

  test("bare /mcp lists available and active", () => {
    expect(parseMcpCommand("", rows)).toEqual({ kind: "list" });
    const message = mcpStatusMessage(rows, [MEDIA]);
    expect(message).toContain("Available: media, knowledge, scimath, photo, pinterest");
    expect(message).toContain("Active in this chat: media");
  });

  test("/mcp <name> activates, /mcp off <name> deactivates", () => {
    const activate = parseMcpCommand("scimath", rows);
    expect(activate).toEqual({ kind: "activate", connectorId: SCIMATH });
    expect(nextConnectorSelection([MEDIA], activate)).toEqual([MEDIA, SCIMATH]);

    const deactivate = parseMcpCommand("off media", rows);
    expect(deactivate).toEqual({ kind: "deactivate", connectorId: MEDIA });
    expect(nextConnectorSelection([MEDIA, SCIMATH], deactivate)).toEqual([SCIMATH]);
  });

  test("/mcp off with no name clears the session", () => {
    expect(nextConnectorSelection([MEDIA, SCIMATH], parseMcpCommand("off", rows))).toEqual([]);
  });

  test("an unregistered name is reported, not silently ignored", () => {
    expect(parseMcpCommand("github", rows)).toEqual({ kind: "unknown", token: "github" });
    expect(nextConnectorSelection([MEDIA], parseMcpCommand("github", rows))).toEqual([MEDIA]);
  });

  test("the command applies the new set and reports it in the transcript", async () => {
    const applied: string[][] = [];
    const notices: string[] = [];
    const [command] = mcpCommandProvider({
      connectors: rows,
      active: [MEDIA],
      apply: async (ids) => {
        applied.push(ids);
        return null;
      },
      notify: (text) => notices.push(text),
    }).commands();

    expect(command.name).toBe("mcp");
    expect(await command.run("scimath", { running: false, compacting: false })).toEqual({
      kind: "handled",
    });
    expect(applied).toEqual([[MEDIA, SCIMATH]]);
    expect(notices.at(-1)).toContain("Active in this chat: media, scimath");

    expect(await command.run("off media", { running: false, compacting: false })).toEqual({
      kind: "handled",
    });
    expect(applied.at(-1)).toEqual([]);
    expect(notices.at(-1)).toContain("Active in this chat: none");
  });

  test("a failed activation surfaces the reason and changes nothing", async () => {
    const notices: string[] = [];
    const [command] = mcpCommandProvider({
      connectors: rows,
      active: [],
      apply: async () => "personal-media-mcp: spawn ENOENT",
      notify: (text) => notices.push(text),
    }).commands();
    await command.run("media", { running: false, compacting: false });
    expect(notices.at(-1)).toBe("MCP \u00b7 personal-media-mcp: spawn ENOENT");
  });
});
