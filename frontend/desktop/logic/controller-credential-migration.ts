import { chmodSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../helpers/fs-json";

const CONTROLLERS_STORAGE_KEY = "local-studio.controllers";

type StoredController = {
  url: string;
  name?: string;
  apiKey: string;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readObject(filePath: string): Record<string, unknown> {
  try {
    if (!existsSync(filePath)) return {};
    return objectRecord(JSON.parse(readFileSync(filePath, "utf8"))) ?? {};
  } catch {
    return {};
  }
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return new URL(value.trim()).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function parseControllers(value: unknown): StoredController[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const record = objectRecord(entry);
      const url = normalizeUrl(record?.url);
      const apiKey = typeof record?.apiKey === "string" ? record.apiKey.trim() : "";
      const name = typeof record?.name === "string" ? record.name.trim() : "";
      return url && apiKey ? [{ url, apiKey, ...(name ? { name } : {}) }] : [];
    });
  } catch {
    return [];
  }
}

function mergeControllers(
  settings: Record<string, unknown>,
  legacy: StoredController[],
): StoredController[] {
  const byUrl = new Map<string, StoredController>();
  const current = Array.isArray(settings.controllers) ? settings.controllers : [];
  for (const entry of current) {
    const record = objectRecord(entry);
    const url = normalizeUrl(record?.url);
    if (!url) continue;
    const apiKey = typeof record?.apiKey === "string" ? record.apiKey.trim() : "";
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    byUrl.set(url, { url, apiKey, ...(name ? { name } : {}) });
  }
  for (const entry of legacy) {
    const currentEntry = byUrl.get(entry.url);
    byUrl.set(entry.url, {
      url: entry.url,
      apiKey: currentEntry?.apiKey || entry.apiKey,
      ...(currentEntry?.name || entry.name ? { name: currentEntry?.name || entry.name } : {}),
    });
  }
  return [...byUrl.values()];
}

export function migrateControllerCredentials(userDataDir: string): void {
  const preferencesPath = path.join(userDataDir, "ui-preferences.json");
  const settingsPath = path.join(userDataDir, "api-settings.json");
  const preferences = readObject(preferencesPath);
  const legacy = parseControllers(preferences[CONTROLLERS_STORAGE_KEY]);
  if (legacy.length > 0) {
    const settings = readObject(settingsPath);
    const controllers = mergeControllers(settings, legacy);
    const activeUrl = normalizeUrl(settings.backendUrl);
    const active = controllers.find((controller) => controller.url === activeUrl);
    writeJsonAtomic(
      settingsPath,
      {
        ...settings,
        controllers,
        ...(active && !settings.apiKey ? { apiKey: active.apiKey } : {}),
      },
      2,
      0o600,
    );
    chmodSync(settingsPath, 0o600);
  }
  if (CONTROLLERS_STORAGE_KEY in preferences) {
    delete preferences[CONTROLLERS_STORAGE_KEY];
    writeJsonAtomic(preferencesPath, preferences);
  }
}

export function saveControllerCredential(userDataDir: string, controller: StoredController): void {
  const settingsPath = path.join(userDataDir, "api-settings.json");
  const settings = readObject(settingsPath);
  const controllers = mergeControllers(settings, [controller]);
  writeJsonAtomic(settingsPath, { ...settings, controllers }, 2, 0o600);
}
