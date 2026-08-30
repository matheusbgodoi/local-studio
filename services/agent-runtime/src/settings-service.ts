// Server-side API settings service: the single owner of reading, writing,
// and merging the persisted `<dataDir>/api-settings.json` file.

import { chmod, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolveSettingsDefaultBackendUrl } from "../../../shared/agent/backend-url";
import {
  DEFAULT_WAKE_READY_TIMEOUT_MS,
  redactWakeUrl,
  type ComputeHostConfig,
} from "../../../shared/agent/compute-host";
import { resolveDataDir, resolveSettingsFilePath } from "./data-dir";

export interface ApiSettings {
  backendUrl: string;
  apiKey: string;
  controllers: ControllerConnection[];
  voiceUrl: string;
  voiceModel: string;
  computeHosts: ComputeHostConfig[];
}

export interface ComputeHostUpdate {
  id: string;
  name?: string;
  controlUrl?: string;
  controlToken?: string;
  clearControlToken?: boolean;
  wakeUrl?: string;
  clearWakeUrl?: boolean;
  wakeEnabled?: boolean;
  autoWake?: boolean;
  readyTimeoutMs?: number;
}

export interface ControllerConnection {
  url: string;
  name?: string;
  apiKey: string;
}

export interface ControllerConnectionUpdate {
  url: string;
  name?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface ApiSettingsUpdate {
  backendUrl?: string;
  apiKey?: string;
  controllers?: ControllerConnectionUpdate[];
  controllerMigrations?: ControllerConnectionUpdate[];
  activateControllerUrl?: string;
  voiceUrl?: string;
  voiceModel?: string;
  computeHosts?: ComputeHostUpdate[];
}

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: resolveSettingsDefaultBackendUrl(),
  apiKey: process.env.API_KEY || "",
  controllers: [],
  voiceUrl: process.env.VOICE_URL || process.env.NEXT_PUBLIC_VOICE_URL || "",
  voiceModel:
    process.env.VOICE_MODEL || process.env.NEXT_PUBLIC_VOICE_MODEL || "whisper-large-v3-turbo",
  computeHosts: [],
};

export async function getApiSettings(): Promise<ApiSettings> {
  const settingsFile = resolveSettingsFilePath();
  if (!existsSync(settingsFile)) return DEFAULT_SETTINGS;
  try {
    await chmod(settingsFile, 0o600).catch(() => undefined);
    const saved = JSON.parse(await readFile(settingsFile, "utf-8")) as Partial<ApiSettings>;
    return {
      backendUrl: saved.backendUrl || DEFAULT_SETTINGS.backendUrl,
      apiKey: typeof saved.apiKey === "string" ? saved.apiKey : DEFAULT_SETTINGS.apiKey,
      controllers: normalizeStoredControllers(saved.controllers),
      voiceUrl: saved.voiceUrl || DEFAULT_SETTINGS.voiceUrl,
      voiceModel: saved.voiceModel || DEFAULT_SETTINGS.voiceModel,
      computeHosts: normalizeStoredComputeHosts(saved.computeHosts),
    };
  } catch (error) {
    console.error(`[API Settings] Failed to read ${settingsFile}:`, error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  resolveDataDir();
  const settingsFile = resolveSettingsFilePath();
  const payload = JSON.stringify(settings, null, 2);
  // Write-then-rename: a crash mid-write would truncate the file, and
  // getApiSettings swallows the parse error and returns defaults — silently
  // wiping the persisted API key and backend URL.
  const tempFile = `${settingsFile}.tmp-${process.pid}`;
  await writeFile(tempFile, payload, "utf-8");
  await chmod(tempFile, 0o600).catch(() => undefined);
  await rename(tempFile, settingsFile);
}

export class InvalidSettingsError extends Error {}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Validate a partial update, merge it over persisted settings, and persist.
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeStoredControllers(value: unknown): ControllerConnection[] {
  if (!Array.isArray(value)) return [];
  const byUrl = new Map<string, ControllerConnection>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? normalizeUrl(record.url) : "";
    if (!url) continue;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
    byUrl.set(url, { url, apiKey, ...(name ? { name } : {}) });
  }
  return [...byUrl.values()];
}

function normalizeStoredComputeHosts(value: unknown): ComputeHostConfig[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, ComputeHostConfig>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) continue;
    const timeout = typeof record.readyTimeoutMs === "number" ? record.readyTimeoutMs : NaN;
    byId.set(id, {
      id,
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
      controlUrl: typeof record.controlUrl === "string" ? normalizeUrl(record.controlUrl) : "",
      controlToken: typeof record.controlToken === "string" ? record.controlToken.trim() : "",
      wakeUrl: typeof record.wakeUrl === "string" ? record.wakeUrl.trim() : "",
      wakeEnabled: record.wakeEnabled === true,
      autoWake: record.autoWake === true,
      readyTimeoutMs:
        Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_WAKE_READY_TIMEOUT_MS,
    });
  }
  return [...byId.values()];
}

function mergedComputeHosts(
  current: ApiSettings,
  updates: ComputeHostUpdate[],
): ComputeHostConfig[] {
  const byId = new Map(current.computeHosts.map((entry) => [entry.id, entry]));
  for (const update of updates) {
    const id = update.id.trim();
    if (!id) continue;
    const previous = byId.get(id);
    const timeout = update.readyTimeoutMs;
    byId.set(id, {
      id,
      name: update.name?.trim() || previous?.name || id,
      controlUrl:
        update.controlUrl !== undefined
          ? normalizeUrl(update.controlUrl)
          : (previous?.controlUrl ?? ""),
      controlToken: update.clearControlToken
        ? ""
        : update.controlToken !== undefined
          ? update.controlToken.trim()
          : (previous?.controlToken ?? ""),
      wakeUrl: update.clearWakeUrl
        ? ""
        : update.wakeUrl !== undefined
          ? update.wakeUrl.trim()
          : (previous?.wakeUrl ?? ""),
      wakeEnabled: update.wakeEnabled ?? previous?.wakeEnabled ?? false,
      autoWake: update.autoWake ?? previous?.autoWake ?? false,
      readyTimeoutMs:
        typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
          ? Math.floor(timeout)
          : (previous?.readyTimeoutMs ?? DEFAULT_WAKE_READY_TIMEOUT_MS),
    });
  }
  return [...byId.values()];
}

function mergedControllers(
  current: ApiSettings,
  updates: ControllerConnectionUpdate[],
): ControllerConnection[] {
  const existing = new Map(current.controllers.map((entry) => [normalizeUrl(entry.url), entry]));
  const activeUrl = normalizeUrl(current.backendUrl);
  if (activeUrl && !existing.has(activeUrl)) {
    existing.set(activeUrl, { url: activeUrl, apiKey: current.apiKey });
  }
  const next = new Map<string, ControllerConnection>();
  for (const update of updates) {
    const url = normalizeUrl(update.url);
    if (!url) continue;
    const previous = existing.get(url);
    const name = update.name?.trim() || previous?.name;
    const apiKey = update.clearApiKey
      ? ""
      : update.apiKey !== undefined
        ? update.apiKey.trim()
        : (previous?.apiKey ?? "");
    next.set(url, { url, apiKey, ...(name ? { name } : {}) });
  }
  return [...next.values()];
}

function migratedControllers(
  current: ApiSettings,
  migrations: ControllerConnectionUpdate[],
): ControllerConnection[] {
  const existing = new Map(current.controllers.map((entry) => [normalizeUrl(entry.url), entry]));
  const activeUrl = normalizeUrl(current.backendUrl);
  if (activeUrl && !existing.has(activeUrl)) {
    existing.set(activeUrl, { url: activeUrl, apiKey: current.apiKey });
  }
  for (const migration of migrations) {
    const url = normalizeUrl(migration.url);
    if (!url) continue;
    const previous = existing.get(url);
    const name = migration.name?.trim() || previous?.name;
    const apiKey = migration.apiKey?.trim() || previous?.apiKey || "";
    existing.set(url, { url, apiKey, ...(name ? { name } : {}) });
  }
  return [...existing.values()];
}

export function apiKeyForController(settings: ApiSettings, url: string): string {
  const normalized = normalizeUrl(url);
  const match = settings.controllers.find((entry) => normalizeUrl(entry.url) === normalized);
  if (match) return match.apiKey;
  return normalizeUrl(settings.backendUrl) === normalized ? settings.apiKey : "";
}

export async function applySettingsUpdate(update: ApiSettingsUpdate): Promise<ApiSettings> {
  const { backendUrl, apiKey, voiceUrl, voiceModel } = update;

  if (backendUrl && !isValidUrl(backendUrl)) {
    throw new InvalidSettingsError("Invalid backend URL format");
  }
  if (voiceUrl && !isValidUrl(voiceUrl)) {
    throw new InvalidSettingsError("Invalid voice URL format");
  }

  const current = await getApiSettings();
  const controllers = update.controllers
    ? mergedControllers(current, update.controllers)
    : update.controllerMigrations
      ? migratedControllers(current, update.controllerMigrations)
      : current.controllers;
  const requestedActiveUrl = update.activateControllerUrl
    ? normalizeUrl(update.activateControllerUrl)
    : "";
  if (update.activateControllerUrl && !requestedActiveUrl) {
    throw new InvalidSettingsError("Invalid controller URL format");
  }
  const nextBackendUrl = requestedActiveUrl || backendUrl || current.backendUrl;
  const activeChanged = normalizeUrl(nextBackendUrl) !== normalizeUrl(current.backendUrl);
  const activatedKey = requestedActiveUrl
    ? (controllers.find((entry) => normalizeUrl(entry.url) === requestedActiveUrl)?.apiKey ??
      (activeChanged ? "" : current.apiKey))
    : undefined;
  const managedActiveKey =
    update.controllers || update.controllerMigrations
      ? controllers.find((entry) => normalizeUrl(entry.url) === normalizeUrl(nextBackendUrl))
          ?.apiKey
      : undefined;
  const next: ApiSettings = {
    backendUrl: nextBackendUrl,
    apiKey:
      activatedKey ?? (apiKey !== undefined ? apiKey.trim() : (managedActiveKey ?? current.apiKey)),
    controllers,
    voiceUrl: voiceUrl || current.voiceUrl,
    voiceModel: voiceModel || current.voiceModel,
    computeHosts: update.computeHosts
      ? mergedComputeHosts(current, update.computeHosts)
      : current.computeHosts,
  };

  await saveApiSettings(next);
  return next;
}

export function settingsView(settings: ApiSettings) {
  const controllers = new Map(
    settings.controllers.map((entry) => [normalizeUrl(entry.url), entry] as const),
  );
  const activeUrl = normalizeUrl(settings.backendUrl);
  if (activeUrl && !controllers.has(activeUrl)) {
    controllers.set(activeUrl, { url: activeUrl, apiKey: settings.apiKey });
  }
  return {
    backendUrl: settings.backendUrl,
    hasApiKey: Boolean(settings.apiKey),
    controllers: [...controllers.values()].map(({ url, name, apiKey }) => ({
      url,
      ...(name ? { name } : {}),
      hasApiKey: Boolean(apiKey),
    })),
    voiceUrl: settings.voiceUrl,
    voiceModel: settings.voiceModel,
    computeHosts: settings.computeHosts.map((host) => ({
      id: host.id,
      name: host.name,
      controlUrl: host.controlUrl,
      hasControlToken: Boolean(host.controlToken),
      wakeUrlPreview: redactWakeUrl(host.wakeUrl),
      hasWakeUrl: Boolean(host.wakeUrl),
      wakeEnabled: host.wakeEnabled,
      autoWake: host.autoWake,
      readyTimeoutMs: host.readyTimeoutMs,
    })),
  };
}

export function computeHostById(settings: ApiSettings, id: string): ComputeHostConfig | null {
  return settings.computeHosts.find((host) => host.id === id) ?? null;
}
