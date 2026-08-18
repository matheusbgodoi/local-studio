// A fresh session must contain ZERO personal skill text in the model prompt,
// while `/skill:<name>` must still resolve. These two pull in opposite
// directions, so the test drives Pi's own loader and prompt formatter rather
// than a stand-in.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatSkillsForPrompt, loadSkills } from "@earendil-works/pi-coding-agent";
import {
  isPersonalSkillPath,
  markPersonalSkillsModelInvocationDisabled,
} from "../src/pi-runtime-helpers";
import { piSkillName } from "../src/skill-discovery";

const root = mkdtempSync(path.join(tmpdir(), "local-studio-skills-"));
const personalRoot = path.join(root, "personal");
const bundledRoot = path.join(root, "bundled");

function writeSkill(root: string, dir: string, frontmatter: string, body: string) {
  const skillDir = path.join(root, dir);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
  return skillDir;
}

const proposalDir = writeSkill(
  personalRoot,
  "nature-proposal-writer",
  'name: researchwrite\ndescription: "Proposal-first scientific writing pipeline."',
  "SECRET_PERSONAL_BODY: never put this in a system prompt.",
);
writeSkill(
  personalRoot,
  "graphify",
  'description: "Turn any input into a knowledge graph."',
  "Another personal body.",
);
writeSkill(
  bundledRoot,
  "browser",
  'name: browser\ndescription: "How to drive the browser_* tools."',
  "Bundled body.",
);

function load() {
  return loadSkills({
    cwd: root,
    agentDir: path.join(root, ".pi"),
    skillPaths: [bundledRoot, personalRoot],
    includeDefaults: false,
  });
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("personal skills: discoverable, not injected", () => {
  test("without the policy, every personal skill leaks into the system prompt", () => {
    const prompt = formatSkillsForPrompt(load().skills);
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("researchwrite");
    expect(prompt).toContain("graphify");
  });

  test("the runtime policy leaves nothing personal in a fresh prompt", () => {
    const marked = markPersonalSkillsModelInvocationDisabled(load(), [personalRoot]);
    const prompt = formatSkillsForPrompt(marked.skills);

    // The bundled Studio skill is still model-invocable.
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("browser");

    // Nothing personal: no name, no description, no location, no body.
    expect(prompt).not.toContain("researchwrite");
    expect(prompt).not.toContain("graphify");
    expect(prompt).not.toContain("Proposal-first scientific writing pipeline");
    expect(prompt).not.toContain("SECRET_PERSONAL_BODY");
    expect(prompt).not.toContain(personalRoot);
  });

  test("with only personal skills the section is omitted entirely", () => {
    const onlyPersonal = loadSkills({
      cwd: root,
      agentDir: path.join(root, ".pi"),
      skillPaths: [personalRoot],
      includeDefaults: false,
    });
    const marked = markPersonalSkillsModelInvocationDisabled(onlyPersonal, [personalRoot]);
    expect(formatSkillsForPrompt(marked.skills)).toBe("");
  });

  test("the disabled skills stay in the set /skill:<name> resolves against", () => {
    const marked = markPersonalSkillsModelInvocationDisabled(load(), [personalRoot]);
    // _expandSkillCommand matches on the EXACT skill name, so the name Studio
    // offers in the composer has to be the one Pi loaded.
    const resolved = marked.skills.find((skill) => skill.name === piSkillName(proposalDir));
    expect(piSkillName(proposalDir)).toBe("researchwrite");
    expect(resolved).toBeDefined();
    expect(resolved?.disableModelInvocation).toBe(true);
    expect(resolved?.filePath).toBe(path.join(proposalDir, "SKILL.md"));
  });

  test("frontmatter is never rewritten — the policy is runtime-only", () => {
    const marked = markPersonalSkillsModelInvocationDisabled(load(), [personalRoot]);
    expect(marked.skills.length).toBe(load().skills.length);
    // Reloading from disk yields the untouched, model-invocable set again.
    expect(load().skills.every((skill) => skill.disableModelInvocation !== true)).toBe(true);
  });

  test("personal-root diagnostics stay out of Studio's panel", () => {
    // Pi warns/collides on third-party SKILL.md files it now loads for
    // /skill: resolution. Those belong to the skill repos, not to Studio.
    const noisy = {
      skills: load().skills,
      diagnostics: [
        { type: "warning", message: "name collision", path: path.join(proposalDir, "SKILL.md") },
        { type: "warning", message: "bundled problem", path: path.join(bundledRoot, "browser") },
        { type: "info", message: "no path" },
      ],
    };
    const marked = markPersonalSkillsModelInvocationDisabled(noisy, [personalRoot]);
    expect(marked.diagnostics.map((entry) => entry.message)).toEqual([
      "bundled problem",
      "no path",
    ]);
  });

  test("only paths under a personal root are marked", () => {
    expect(isPersonalSkillPath(path.join(proposalDir, "SKILL.md"), [personalRoot])).toBe(true);
    expect(isPersonalSkillPath(path.join(bundledRoot, "browser", "SKILL.md"), [personalRoot])).toBe(
      false,
    );
    // A sibling directory whose name merely starts with the root must not match.
    expect(isPersonalSkillPath(`${personalRoot}-other/x/SKILL.md`, [personalRoot])).toBe(false);
  });
});
