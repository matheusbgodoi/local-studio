"use client";

import { useCallback, useRef, useState } from "react";
import api from "@/lib/api/client";
import { createApiClient } from "@/lib/api/create-api-client";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { getStoredBackendUrl, resolveSettingsDefaultBackendUrl } from "@/lib/api/connection";
import {
  migrateLegacyControllerCredentials,
  normalizeControllerUrl,
  saveSavedControllers,
} from "@/lib/api/controllers";
import { readPageCache, scopedPageCacheKey, writePageCache } from "@/lib/page-data-cache";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "./types";
import type { CapabilityState } from "@local-studio/contracts/capabilities";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;
const CONNECTION_TEST_REQUEST = { timeout: 10_000, retries: 0 } as const;
const FAST_COMPAT_REQUEST = { timeout: 20_000, retries: 0 } as const;
const FAST_CONFIG_REQUEST = { timeout: 20_000, retries: 0 } as const;

const DEFAULT_BACKEND_URL = resolveSettingsDefaultBackendUrl();

const DEFAULT_API_SETTINGS: ApiConnectionSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  apiKey: "",
  hasApiKey: false,
  controllers: [],
};

const mergeApiSettings = (server?: Partial<ApiConnectionSettings>): ApiConnectionSettings => {
  const localBackendUrl = getStoredBackendUrl();
  return {
    backendUrl: localBackendUrl || server?.backendUrl || DEFAULT_API_SETTINGS.backendUrl,
    apiKey: "",
    hasApiKey: Boolean(server?.hasApiKey),
    controllers: server?.controllers ?? [],
  };
};

function rejectionMessage(result: PromiseSettledResult<unknown>, fallback: string): string | null {
  if (result.status !== "rejected") return null;
  return result.reason instanceof Error ? result.reason.message : fallback;
}

export function useSettings(
  controllerKey: string,
  configCapability: CapabilityState,
  compatibilityCapability: CapabilityState,
) {
  const configCacheKey = scopedPageCacheKey(controllerKey, "settings:config");
  const compatibilityCacheKey = scopedPageCacheKey(controllerKey, "settings:compat");
  // Stale-while-revalidate: seed from the last-loaded config so navigating to
  // Settings paints instantly while the controller fetch refreshes it.
  const [data, setData] = useState<ConfigData | null>(() =>
    readPageCache<ConfigData>(configCacheKey),
  );
  const [compatibilityReport, setCompatibilityReport] = useState<CompatibilityReport | null>(() =>
    readPageCache<CompatibilityReport>(compatibilityCacheKey),
  );
  // Config/compat (the heavy /config + /compat controller round-trips) are only
  // consumed by the System section. They load lazily the first time System is
  // opened, so the default Connection landing paints from /api/settings alone.
  // `loading` therefore starts false — nothing is in flight until then.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const configRequestedRef = useRef(false);

  const [apiSettings, setApiSettings] = useState<ApiConnectionSettings>(DEFAULT_API_SETTINGS);
  const [apiSettingsLoading, setApiSettingsLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("unknown");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const activeRef = useRef(false);
  const apiSettingsSequence = useRef(0);
  const connectionSequence = useRef(0);
  const healthSequence = useRef(0);
  const configSequence = useRef(0);

  useMountSubscription(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      apiSettingsSequence.current += 1;
      connectionSequence.current += 1;
      healthSequence.current += 1;
      configSequence.current += 1;
    };
  }, [controllerKey]);

  const loadApiSettings = useCallback(async () => {
    const requestId = ++apiSettingsSequence.current;
    try {
      setApiSettingsLoading(true);
      const migrationComplete = await migrateLegacyControllerCredentials();
      if (!activeRef.current || requestId !== apiSettingsSequence.current) return;
      const res = await fetch("/api/settings");
      if (!activeRef.current || requestId !== apiSettingsSequence.current) return;
      if (res.ok) {
        const settings = (await res.json()) as Partial<ApiConnectionSettings>;
        if (!activeRef.current || requestId !== apiSettingsSequence.current) return;
        if (migrationComplete && settings.controllers) saveSavedControllers(settings.controllers);
        setApiSettings(mergeApiSettings(settings));
        return;
      }
    } catch (e) {
      if (activeRef.current && requestId === apiSettingsSequence.current) {
        console.error("Failed to load API settings:", e);
      }
    } finally {
      if (activeRef.current && requestId === apiSettingsSequence.current) {
        setApiSettingsLoading(false);
      }
    }
    if (activeRef.current && requestId === apiSettingsSequence.current) {
      setApiSettings(mergeApiSettings(undefined));
    }
  }, []);

  const testConnection = useCallback(async () => {
    const requestId = ++connectionSequence.current;
    try {
      setTesting(true);
      setConnectionStatus("unknown");
      setStatusMessage("Testing...");

      const baseUrl = normalizeControllerUrl(apiSettings.backendUrl ?? "");
      if (!baseUrl) {
        setConnectionStatus("error");
        setStatusMessage("Missing API URL");
        return;
      }

      const probe = createApiClient({
        baseUrl: "/api/proxy",
        useProxy: true,
        backendUrlOverride: baseUrl,
        ...(apiSettings.apiKey ? { apiKeyOverride: apiSettings.apiKey } : {}),
      });
      await probe.getStatus(CONNECTION_TEST_REQUEST);
      if (!activeRef.current || requestId !== connectionSequence.current) return;
      setConnectionStatus("connected");
      setStatusMessage("Connected");
    } catch (e) {
      if (activeRef.current && requestId === connectionSequence.current) {
        setConnectionStatus("error");
        setStatusMessage((e as Error).message || "Connection failed");
      }
    } finally {
      if (activeRef.current && requestId === connectionSequence.current) setTesting(false);
    }
  }, [apiSettings.apiKey, apiSettings.backendUrl]);

  const checkBackendHealth = useCallback(async () => {
    const requestId = ++healthSequence.current;
    try {
      await api.getStatus(FAST_STATUS_REQUEST);
      if (!activeRef.current || requestId !== healthSequence.current) return false;
      setBackendOnline(true);
      // A reachable controller means first-run setup is effectively done. This
      // flag used to be set by the config fetch, which now loads lazily.
      if (typeof window !== "undefined" && !localStorage.getItem("local-studio-setup-complete")) {
        localStorage.setItem("local-studio-setup-complete", "true");
      }
      return true;
    } catch {
      if (!activeRef.current || requestId !== healthSequence.current) return false;
      setBackendOnline(false);
      return false;
    }
  }, []);

  const loadConfig = useCallback(async () => {
    const requestId = ++configSequence.current;
    try {
      setLoading(true);
      setError(null);
      const [configResult, compatibilityResult] = await Promise.allSettled([
        configCapability === "supported"
          ? api.getSystemConfig(FAST_CONFIG_REQUEST)
          : Promise.resolve(null),
        compatibilityCapability === "supported"
          ? api.getCompatibility(FAST_COMPAT_REQUEST)
          : Promise.resolve(null),
      ]);
      if (!activeRef.current || requestId !== configSequence.current) return;

      const configData = configResult.status === "fulfilled" ? configResult.value : null;
      const compatibility =
        compatibilityResult.status === "fulfilled" ? compatibilityResult.value : null;
      const errors = [
        rejectionMessage(configResult, "System configuration could not be loaded"),
        rejectionMessage(compatibilityResult, "Compatibility could not be loaded"),
      ].filter((message): message is string => Boolean(message));
      if (configData) {
        writePageCache(configCacheKey, configData);
        setData(configData);
      }
      if (compatibility) {
        writePageCache(compatibilityCacheKey, compatibility);
        setCompatibilityReport(compatibility);
      }
      const receivedSystemData = Boolean(configData || compatibility);
      setError(errors.length ? errors.join(" · ") : null);
      if (receivedSystemData) {
        healthSequence.current += 1;
        setBackendOnline(true);
        if (typeof window !== "undefined" && !localStorage.getItem("local-studio-setup-complete")) {
          localStorage.setItem("local-studio-setup-complete", "true");
        }
      } else if (errors.length) {
        await checkBackendHealth();
      }
    } catch (e) {
      if (activeRef.current && requestId === configSequence.current) {
        setError((e as Error).message);
        await checkBackendHealth();
      }
    } finally {
      if (activeRef.current && requestId === configSequence.current) setLoading(false);
    }
  }, [
    checkBackendHealth,
    compatibilityCacheKey,
    compatibilityCapability,
    configCacheKey,
    configCapability,
  ]);

  // Lazy trigger: called when the System section becomes active. Fires the
  // config/compat fetch exactly once (subsequent visits reuse the cached data);
  // explicit refresh via `loadConfig` still forces a reload.
  const ensureConfigLoaded = useCallback(() => {
    if (configRequestedRef.current) return;
    configRequestedRef.current = true;
    void loadConfig();
  }, [loadConfig]);

  useMountSubscription(() => {
    if (configRequestedRef.current) void loadConfig();
  }, [loadConfig]);

  useMountSubscription(() => {
    void loadApiSettings();
    // Cheap /status probe (not /config) so the first-run setup wizard gate still
    // knows whether the controller is reachable without the heavy config fetch.
    void checkBackendHealth();
  }, [checkBackendHealth, loadApiSettings]);

  return {
    data,
    compatibilityReport,
    loading,
    error,
    apiSettings,
    apiSettingsLoading,
    testing,
    connectionStatus,
    statusMessage,
    setApiSettings,
    loadConfig,
    ensureConfigLoaded,
    testConnection,
    hasConfigData: Boolean(data || compatibilityReport),
    isInitialLoading: loading && !data && !compatibilityReport,
    backendOnline,
  };
}
