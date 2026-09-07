export const CONTROLLERS_STORAGE_KEY = "local-studio.controllers";
const LEGACY_CONTROLLERS_STORAGE_KEY = [["v", "llm-studio"].join(""), "controllers"].join(".");
export const CONTROLLERS_CHANGED_EVENT = "vllm:controllers-changed";

export type SavedController = {
  url: string;
  name?: string;
  hasApiKey?: boolean;
};

type LegacyControllerCredential = SavedController & { apiKey?: string };

let migrationInFlight: Promise<boolean> | null = null;

export function normalizeControllerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/\/v1\/?$/i, "") || "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  }
}

function parseSavedController(entry: unknown): LegacyControllerCredential | null {
  if (typeof entry === "string") {
    const url = normalizeControllerUrl(entry);
    return url ? { url } : null;
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? normalizeControllerUrl(record.url) : "";
  if (!url) return null;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const hasApiKey = apiKey || record.hasApiKey === true;
  const out: LegacyControllerCredential = { url };
  if (apiKey) out.apiKey = apiKey;
  if (name) out.name = name;
  if (hasApiKey) out.hasApiKey = true;
  return out;
}

function publicController(controller: LegacyControllerCredential): SavedController {
  const { url, name, hasApiKey, apiKey } = controller;
  return {
    url,
    ...(name ? { name } : {}),
    ...(hasApiKey || apiKey ? { hasApiKey: true } : {}),
  };
}

function persistPublicControllers(controllers: SavedController[]): void {
  window.localStorage.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(controllers));
  window.localStorage.removeItem(LEGACY_CONTROLLERS_STORAGE_KEY);
}

function migrateLegacyCredentials(controllers: LegacyControllerCredential[]): Promise<boolean> {
  if (!controllers.some((controller) => controller.apiKey)) return Promise.resolve(true);
  if (!migrationInFlight) {
    migrationInFlight = fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        controllerMigrations: controllers.map(({ url, name, apiKey }) => ({ url, name, apiKey })),
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Controller credential migration failed");
        persistPublicControllers(controllers.map(publicController));
        window.dispatchEvent(new Event("storage"));
        return true;
      })
      .catch(() => false)
      .finally(() => {
        migrationInFlight = null;
      });
  }
  return migrationInFlight;
}

function readStoredControllers(): LegacyControllerCredential[] {
  const raw =
    window.localStorage.getItem(CONTROLLERS_STORAGE_KEY) ||
    window.localStorage.getItem(LEGACY_CONTROLLERS_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  const byUrl = new Map<string, LegacyControllerCredential>();
  for (const entry of parsed) {
    const controller = parseSavedController(entry);
    if (!controller) continue;
    byUrl.set(controller.url, { ...byUrl.get(controller.url), ...controller });
  }
  return [...byUrl.values()];
}

export async function migrateLegacyControllerCredentials(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  try {
    return await migrateLegacyCredentials(readStoredControllers());
  } catch {
    return false;
  }
}

export function loadSavedControllers(): SavedController[] {
  if (typeof window === "undefined") return [];
  try {
    const legacy = readStoredControllers();
    const next = legacy.map(publicController);
    void migrateLegacyCredentials(legacy);
    if (!legacy.some((controller) => controller.apiKey)) persistPublicControllers(next);
    return next;
  } catch {
    return [];
  }
}

export function saveSavedControllers(controllers: SavedController[]): SavedController[] {
  if (typeof window === "undefined") return [];
  const byUrl = new Map<string, SavedController>();
  for (const controller of controllers) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    const name = controller.name?.trim();
    const out: SavedController = { url };
    if (name) out.name = name;
    if (controller.hasApiKey) out.hasApiKey = true;
    byUrl.set(url, out);
  }
  const next = [...byUrl.values()];
  window.localStorage.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(CONTROLLERS_CHANGED_EVENT, { detail: { controllers: next } }),
  );
  window.dispatchEvent(new Event("storage"));
  return next;
}
