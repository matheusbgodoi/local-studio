// Typing `/` has to surface both families, and `/skill:<fragment>` has to
// narrow inside the skill namespace rather than scoring every entry as a miss.

import { describe, expect, test } from "bun:test";
import {
  createComposerCommandRegistry,
  parseSlashInvocation,
  scopeToNamespace,
} from "../../../frontend/src/features/agent/composer/command-registry";
import { skillInvocationCommandProvider } from "../../../frontend/src/features/agent/composer/skill-invocation-commands";
import { mcpCommandProvider } from "../../../frontend/src/features/agent/composer/mcp-commands";

const CONTEXT = { running: false, compacting: false };

const skills = [
  { id: "1", name: "nature figure", piName: "nature-figure" },
  { id: "2", name: "nature proposal writer", piName: "researchwrite" },
  { id: "3", name: "deep research", piName: "deep-research" },
];

function registry(runSkill: (skill: (typeof skills)[number], args: string) => Promise<void>) {
  return createComposerCommandRegistry([
    mcpCommandProvider({
      connectors: [],
      active: [],
      apply: async () => null,
      notify: () => undefined,
    }),
    skillInvocationCommandProvider({ skills, runSkill }),
  ]);
}

describe("composer command surface", () => {
  const names = (query: string) =>
    registry(async () => undefined)
      .match(query, CONTEXT)
      .map((command) => command.name);

  test("typing / surfaces /mcp and the /skill: family", () => {
    expect(names("")).toEqual([
      "mcp",
      "skill:nature-figure",
      "skill:researchwrite",
      "skill:deep-research",
    ]);
  });

  test("/skill: alone lists the whole family", () => {
    expect(names("skill:").sort()).toEqual([
      "skill:deep-research",
      "skill:nature-figure",
      "skill:researchwrite",
    ]);
  });

  test("/skill:<fragment> fuzzy-searches inside the namespace", () => {
    expect(names("skill:fig")).toEqual(["skill:nature-figure"]);
    expect(names("skill:res")).toContain("skill:researchwrite");
    expect(names("skill:zzz")).toEqual([]);
  });

  test("a namespace nobody claims falls back to a flat search", () => {
    const commands = registry(async () => undefined).list(CONTEXT);
    expect(scopeToNamespace(commands, "nope:thing").commands).toEqual(commands);
    expect(scopeToNamespace(commands, "mc").query).toBe("mc");
  });

  test("the typed invocation resolves and carries its args", async () => {
    const invocation = parseSlashInvocation("/skill:nature-figure plot the results");
    expect(invocation).toEqual({ name: "skill:nature-figure", args: "plot the results" });

    const sent: Array<[string, string]> = [];
    const outcome = await registry(async (skill, args) => {
      sent.push([skill.piName, args]);
    }).execute(invocation!, CONTEXT);

    expect(outcome).toEqual({ kind: "handled" });
    expect(sent).toEqual([["nature-figure", "plot the results"]]);
  });

  test("/mcp parses as a plain command, unaffected by the namespace rule", () => {
    expect(parseSlashInvocation("/mcp off media")).toEqual({ name: "mcp", args: "off media" });
    expect(registry(async () => undefined).find("mcp", CONTEXT)?.title).toBe("MCP");
  });
});
