"use client";

import { useMemo, useState } from "react";
import { Check, Link as LinkIcon, X } from "@/ui/icon-registry";
import { StatusPill, Spinner } from "@/ui";
import { ApiUrlCensorToggle, CensoredApiUrl } from "@/ui/api-url-censor";
import { setStoredBackendUrl } from "@/lib/api/connection";
import {
  normalizeControllerUrl,
  saveSavedControllers,
  type SavedController,
} from "@/lib/api/controllers";
import { AppVersionSection } from "./app-version-section";
import {
  SettingsButton,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsValue,
  type StatusTone,
} from "./settings-ui";
import type { ApiConnectionSettings, ConnectionStatus } from "./types";
import { AdvancedControllerSettings, type ControllerUpdate } from "./advanced-controller-settings";
import type { DeployedController } from "./deploy-controller-panel";

type SettingsResponse = Partial<ApiConnectionSettings> & { error?: string };

export function ApiConnectionSection({
  apiSettingsLoading,
  apiSettings,
  testing,
  connectionStatus,
  statusMessage,
  onApiSettingsChange,
  onTestConnection,
}: {
  apiSettingsLoading: boolean;
  apiSettings: ApiConnectionSettings;
  testing: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onTestConnection: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeUrl = normalizeControllerUrl(apiSettings.backendUrl);
  const controllers = useMemo(() => {
    const byUrl = new Map(
      (apiSettings.controllers ?? []).map((controller) => [
        normalizeControllerUrl(controller.url),
        controller,
      ]),
    );
    if (activeUrl && !byUrl.has(activeUrl)) {
      byUrl.set(activeUrl, {
        url: activeUrl,
        hasApiKey: apiSettings.hasApiKey,
      });
    }
    return [...byUrl.values()].filter((controller) => controller.url);
  }, [activeUrl, apiSettings.controllers, apiSettings.hasApiKey]);
  const activeController = controllers.find(
    (controller) => normalizeControllerUrl(controller.url) === activeUrl,
  );

  const applyResponse = (response: SettingsResponse) => {
    const responseControllers = response.controllers ?? apiSettings.controllers ?? [];
    const next: ApiConnectionSettings = {
      backendUrl: response.backendUrl ?? apiSettings.backendUrl,
      apiKey: "",
      hasApiKey: Boolean(response.hasApiKey),
      controllers: responseControllers,
    };
    saveSavedControllers(responseControllers);
    onApiSettingsChange(next);
    return next;
  };

  const postSettings = async (body: Record<string, unknown>) => {
    setSaving(true);
    setActionError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as SettingsResponse;
      if (!response.ok) throw new Error(result.error || "Could not save controller settings");
      return applyResponse(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save controller settings");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const updateControllers = async (next: ControllerUpdate[]) => {
    const updated = await postSettings({ controllers: next });
    return Boolean(updated);
  };

  const activateController = async (controller: SavedController) => {
    const url = normalizeControllerUrl(controller.url);
    if (!url) return false;
    const updated = await postSettings({ activateControllerUrl: url });
    if (!updated) return false;
    setStoredBackendUrl(updated.backendUrl);
    return true;
  };

  const onDeployed = async (controller: DeployedController) => {
    const url = normalizeControllerUrl(controller.url);
    if (!url) return;
    const existing = controllers.filter((entry) => normalizeControllerUrl(entry.url) !== url);
    const saved = await updateControllers([
      ...existing,
      {
        url,
        name: controller.name,
        hasApiKey: controller.hasApiKey,
      },
    ]);
    if (saved) await activateController({ url, name: controller.name });
  };

  return (
    <div>
      <AppVersionSection />
      <SettingsGroup
        title="Active controller"
        description="The controller Local Studio is using now."
        actions={<ApiUrlCensorToggle />}
      >
        <SettingsRow
          label={activeController?.name || "Current controller"}
          description={
            <CensoredApiUrl className="font-mono text-[length:var(--fs-xs)]">
              {apiSettings.backendUrl}
            </CensoredApiUrl>
          }
          value={
            <SettingsValue dim={!apiSettings.hasApiKey}>
              {apiSettings.hasApiKey ? "Credential configured" : "No credential"}
            </SettingsValue>
          }
          status={
            <ApiStatus
              status={connectionStatus}
              message={statusMessage}
              loading={apiSettingsLoading}
            />
          }
          actions={
            <SettingsButton onClick={onTestConnection} disabled={testing || apiSettingsLoading}>
              {testing ? <Spinner size="xs" /> : <LinkIcon className="h-3 w-3" />}
              Test
            </SettingsButton>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Advanced"
        description="Manage controllers, credentials, and SSH deployment."
        collapsible
        defaultOpen={false}
      >
        <AdvancedControllerSettings
          controllers={controllers}
          activeUrl={activeUrl}
          saving={saving}
          onUpdate={updateControllers}
          onActivate={activateController}
          onDeployed={onDeployed}
        />
      </SettingsGroup>
      {actionError ? (
        <SettingsNotice tone="danger" className="-mt-3">
          {actionError}
        </SettingsNotice>
      ) : null}
    </div>
  );
}

function ApiStatus({
  status,
  message,
  loading,
}: {
  status: ConnectionStatus;
  message: string;
  loading: boolean;
}) {
  if (loading) return <StatusPill tone="info">loading</StatusPill>;
  const tone: StatusTone =
    status === "connected" ? "good" : status === "error" ? "danger" : "default";
  const label = message || (status === "unknown" ? "not tested" : status);
  return (
    <span className="inline-flex items-center gap-1.5">
      {status === "connected" ? <Check className="h-3 w-3 text-(--hl2)" /> : null}
      {status === "error" ? <X className="h-3 w-3 text-(--err)" /> : null}
      <StatusPill tone={tone}>{label}</StatusPill>
    </span>
  );
}
