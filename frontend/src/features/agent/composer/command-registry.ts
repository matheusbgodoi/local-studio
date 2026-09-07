// The minimal composer command processor: parse a "/name args" invocation,
// aggregate commands from registered providers, and dispatch. Pure TS — no
// React, no fetch, no knowledge of any concrete command.
import { byQuery } from "@/features/agent/composer-context";
import type {
  ComposerCommand,
  ComposerCommandContext,
  ComposerCommandOutcome,
  ComposerCommandProvider,
} from "./command-types";

export type SlashInvocation = { name: string; args: string };

export function parseSlashInvocation(input: string): SlashInvocation | null {
  const match = /^\/([\w][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

/**
 * Namespaced command families ("/skill:<name>") search INSIDE the namespace: the
 * typed prefix picks the family and the rest is the fuzzy query. Without this
 * "/skill:fig" scores every skill command as a miss — byQuery only does
 * prefix/substring on the whole name, and no name contains "skill:fig".
 * Falls back to a flat search when the prefix names no family.
 */
export function scopeToNamespace(
  commands: ComposerCommand[],
  query: string,
): { commands: ComposerCommand[]; query: string } {
  const match = /^([\w][\w.-]*):([\s\S]*)$/.exec(query.trim());
  if (!match) return { commands, query };
  const prefix = `${match[1].toLowerCase()}:`;
  const scoped = commands.filter((command) => command.name.toLowerCase().startsWith(prefix));
  return scoped.length > 0 ? { commands: scoped, query: match[2] } : { commands, query };
}

export type ComposerCommandRegistry = {
  list: (context: ComposerCommandContext) => ComposerCommand[];
  find: (name: string, context: ComposerCommandContext) => ComposerCommand | null;
  match: (query: string, context: ComposerCommandContext, limit?: number) => ComposerCommand[];
  execute: (
    invocation: SlashInvocation,
    context: ComposerCommandContext,
  ) => Promise<ComposerCommandOutcome> | null;
};

export function createComposerCommandRegistry(
  providers: ComposerCommandProvider[],
): ComposerCommandRegistry {
  const list = (context: ComposerCommandContext): ComposerCommand[] => {
    const seen = new Set<string>();
    const commands: ComposerCommand[] = [];
    for (const provider of providers) {
      for (const command of provider.commands()) {
        const key = command.name.toLowerCase();
        if (seen.has(key)) continue;
        if (command.when && !command.when(context)) continue;
        seen.add(key);
        commands.push(command);
      }
    }
    return commands;
  };

  const find = (name: string, context: ComposerCommandContext): ComposerCommand | null => {
    const key = name.toLowerCase();
    return list(context).find((command) => command.name.toLowerCase() === key) ?? null;
  };

  const match = (query: string, context: ComposerCommandContext, limit = 8): ComposerCommand[] => {
    const commands = list(context);
    // Empty query keeps provider order (builtins → templates → skills) so core
    // commands lead the menu; byQuery would sort the whole set alphabetically.
    if (!query.trim()) return commands.slice(0, limit);
    const scoped = scopeToNamespace(commands, query);
    const rows = scoped.commands.map((command) => ({
      name: command.name,
      displayName: command.title,
      source: command.source,
      shortDescription: command.description,
      command,
    }));
    return byQuery(rows, scoped.query, limit).map((row) => row.command);
  };

  const execute = (invocation: SlashInvocation, context: ComposerCommandContext) => {
    const command = find(invocation.name, context);
    if (!command) return null;
    return Promise.resolve(command.run(invocation.args, context)).catch(
      (error): ComposerCommandOutcome => ({
        kind: "error",
        message: error instanceof Error ? error.message : `/${command.name} failed`,
      }),
    );
  };

  return { list, find, match, execute };
}
