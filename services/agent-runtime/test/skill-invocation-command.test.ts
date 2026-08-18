// `/skill:<name>` resolves the skill Studio discovered, applies it to ONE task,
// and leaves nothing behind.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import {
  piSkillCommandName,
  skillInvocationCommandProvider,
  skillInvocationText,
} from "../../../frontend/src/features/agent/composer/skill-invocation-commands";
import { discoverSkills } from "../src/skill-discovery";

/** Pi's own parse (dist/core/agent-session.js _expandSkillCommand): the skill
 *  name runs to the FIRST space, everything after it is the user's args. */
function piExpansionTarget(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/skill:")) return null;
  const spaceIndex = text.indexOf(" ");
  return {
    name: spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex),
    args: spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim(),
  };
}

const root = mkdtempSync(path.join(tmpdir(), "local-studio-skill-cmd-"));
const skillsDir = path.join(root, "skills");
mkdirSync(path.join(skillsDir, "nature-proposal-writer"), { recursive: true });
writeFileSync(
  path.join(skillsDir, "nature-proposal-writer", "SKILL.md"),
  '---\nname: researchwrite\ndescription: "Proposal-first scientific writing."\n---\n\nBody.\n',
  "utf8",
);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("/skill:<name>", () => {
  test("uses the name Pi resolves by, not Studio's display label", () => {
    const [row] = discoverSkills([{ source: "test", dir: skillsDir }]);
    // Studio de-slugs the directory for display; Pi matches frontmatter `name`.
    expect(row.name).toBe("nature proposal writer");
    expect(row.piName).toBe("researchwrite");
    expect(
      piSkillCommandName({ id: row.id, name: row.name, path: row.path, piName: row.piName }),
    ).toBe("researchwrite");
  });

  test("the command name is what the composer parses, the text is what Pi expands", async () => {
    const [row] = discoverSkills([{ source: "test", dir: skillsDir }]);
    const skill = { id: row.id, name: row.name, path: row.path, piName: row.piName };
    const sent: Array<{ name: string; args: string }> = [];
    const provider = skillInvocationCommandProvider({
      skills: [skill],
      runSkill: async (chosen, args) => {
        sent.push({ name: piSkillCommandName(chosen), args });
      },
    });

    const [command] = provider.commands();
    expect(command.name).toBe("skill:researchwrite");

    const outcome = await command.run("draft the intro", { running: false, compacting: false });
    expect(outcome).toEqual({ kind: "handled" });
    expect(sent).toEqual([{ name: "researchwrite", args: "draft the intro" }]);

    // The message Pi receives resolves to the loaded skill.
    const text = skillInvocationText(skill, "draft the intro");
    const target = piExpansionTarget(text);
    const loaded = loadSkills({
      cwd: root,
      agentDir: path.join(root, ".pi"),
      skillPaths: [skillsDir],
      includeDefaults: false,
    });
    expect(target).toEqual({ name: "researchwrite", args: "draft the intro" });
    expect(loaded.skills.some((entry) => entry.name === target?.name)).toBe(true);
  });

  test("an argument-less invocation still parses (the trailing space matters)", () => {
    const skill = { id: "x", name: "Research Write", piName: "researchwrite" };
    const target = piExpansionTarget(skillInvocationText(skill, ""));
    expect(target).toEqual({ name: "researchwrite", args: "" });
  });

  test("falls back to the directory basename when frontmatter carries no name", () => {
    expect(piSkillCommandName({ id: "y", name: "Deep Research", path: "/a/b/deep-research" })).toBe(
      "deep-research",
    );
  });

  test("duplicate pi names collapse to one command", () => {
    const provider = skillInvocationCommandProvider({
      skills: [
        { id: "a", name: "A", piName: "dup" },
        { id: "b", name: "B", piName: "dup" },
      ],
      runSkill: async () => undefined,
    });
    expect(provider.commands().map((command) => command.name)).toEqual(["skill:dup"]);
  });
});
