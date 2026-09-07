import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";

export const DEFAULT_AGENT_MODEL_KEY = "local-studio.agent.defaultModel";

const DEFAULT_MODEL_MIGRATIONS: Readonly<Record<string, string>> = {
  "qwen-turbo": "ornith-turbo",
  "qwen-uncensored": "qwen-daily",
};

function migrate(modelId: string): string {
  return DEFAULT_MODEL_MIGRATIONS[modelId] ?? modelId;
}

export function readDefaultAgentModel(storage: Pick<Storage, "getItem">): string {
  return migrate(storage.getItem(DEFAULT_AGENT_MODEL_KEY)?.trim() ?? "");
}

export function readAndMigrateDefaultAgentModel(
  storage: Pick<Storage, "getItem" | "setItem">,
): string {
  const stored = storage.getItem(DEFAULT_AGENT_MODEL_KEY)?.trim() ?? "";
  const migrated = migrate(stored);
  if (migrated !== stored) writeDefaultAgentModel(storage, migrated);
  return migrated;
}

export function writeDefaultAgentModel(storage: Pick<Storage, "setItem">, modelId: string): void {
  storage.setItem(DEFAULT_AGENT_MODEL_KEY, modelId);
  if (typeof window !== "undefined" && storage === window.localStorage) {
    scheduleDurableUiPreferencesSave();
  }
}
