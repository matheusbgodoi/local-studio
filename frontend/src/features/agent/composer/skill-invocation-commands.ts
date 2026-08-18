// `/skill:<name>` — apply one personal skill to ONE task.
//
// Distinct from the legacy `$skill` selected-context flow (composer-refs.ts
// selectedContextPrompt), which arms a skill on the session and re-sends its
// body with the next message. This provider sends Pi's own `/skill:<name> args`
// invocation as the turn message: Pi expands it into a <skill> block for that
// message only (dist/core/agent-session.js _expandSkillCommand), so nothing
// sticks to later turns or later sessions.
//
// The skills themselves are the ones Studio already discovers
// (GET /api/agent/skills); the agent runtime marks them model-invocation-
// disabled, so none of them costs a byte of system prompt until this command
// names one.

import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type { ComposerCommand, ComposerCommandProvider } from "./command-types";

export const SKILL_COMMAND_NAMESPACE = "skill";

/**
 * The name Pi resolves the skill by. `piName` is read from SKILL.md frontmatter
 * by the runtime's discovery; the directory basename is Pi's own fallback, and
 * the display name is the last resort (it is de-slugged, so it can miss).
 */
export function piSkillCommandName(skill: ComposerSkillRef): string {
  const fromPath = skill.path
    ?.replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop();
  const raw = skill.piName || fromPath || skill.name;
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

export function skillInvocationCommandProvider(options: {
  skills: ComposerSkillRef[];
  /** Send `/skill:<name> <args>` as this turn's message. */
  runSkill: (skill: ComposerSkillRef, args: string) => Promise<void>;
}): ComposerCommandProvider {
  return {
    id: "skill-invocations",
    commands: () => {
      const seen = new Set<string>();
      return options.skills.flatMap((skill): ComposerCommand[] => {
        const piName = piSkillCommandName(skill);
        if (!piName || seen.has(piName)) return [];
        seen.add(piName);
        return [
          {
            id: `skill-invocation:${skill.id || piName}`,
            name: `${SKILL_COMMAND_NAMESPACE}:${piName}`,
            title: skill.name,
            description: `Apply this skill to this task only`,
            source: skill.source ?? "skills",
            icon: "skill",
            run: async (args) => {
              await options.runSkill(skill, args.trim());
              return { kind: "handled" };
            },
          },
        ];
      });
    },
  };
}

/** The literal text Pi expands. Kept next to the provider so the wire format
 *  lives in one place: `_expandSkillCommand` reads the name up to the FIRST
 *  space, so the invocation must lead the message and keep that separator. */
export function skillInvocationText(skill: ComposerSkillRef, args: string): string {
  const trimmed = args.trim();
  return `/${SKILL_COMMAND_NAMESPACE}:${piSkillCommandName(skill)}${trimmed ? ` ${trimmed}` : " "}`;
}
