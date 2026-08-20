export const DEFAULT_AGENT_MODEL_KEY = "local-studio.agent.defaultModel";

/**
 * One retired alias, one replacement. Applied on read, rewritten once on disk.
 *
 * On 2026-08-20 the Turbo role moved from `qwen-turbo` to `ornith-turbo` and the
 * router stopped answering to the old id. A workspace that remembered it would
 * otherwise open on a model the catalogue no longer contains — correctly shown as
 * unavailable, but for a role that is very much still there.
 *
 * This is deliberately NOT a fallback. It rewrites exactly this one string;
 * anything else the user remembered, including a model that really is gone, is
 * returned untouched and stays selected-but-unavailable.
 */
const RETIRED_MODEL_IDS: Readonly<Record<string, string>> = {
  "qwen-turbo": "ornith-turbo",
};

function migrate(modelId: string): string {
  return RETIRED_MODEL_IDS[modelId] ?? modelId;
}

export function readDefaultAgentModel(storage: Pick<Storage, "getItem">): string {
  return migrate(storage.getItem(DEFAULT_AGENT_MODEL_KEY)?.trim() ?? "");
}

/** Read, and persist the migration so it happens once rather than every read. */
export function readAndMigrateDefaultAgentModel(
  storage: Pick<Storage, "getItem" | "setItem">,
): string {
  const stored = storage.getItem(DEFAULT_AGENT_MODEL_KEY)?.trim() ?? "";
  const migrated = migrate(stored);
  if (migrated !== stored) storage.setItem(DEFAULT_AGENT_MODEL_KEY, migrated);
  return migrated;
}

export function writeDefaultAgentModel(storage: Pick<Storage, "setItem">, modelId: string): void {
  storage.setItem(DEFAULT_AGENT_MODEL_KEY, modelId);
}
