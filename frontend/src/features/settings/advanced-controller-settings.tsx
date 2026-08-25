"use client";

import { useState } from "react";
import { Plus, Save, Trash2 } from "@/ui/icon-registry";
import { CensoredApiUrl } from "@/ui/api-url-censor";
import { normalizeControllerUrl, type SavedController } from "@/lib/api/controllers";
import { DeployControllerPanel, type DeployedController } from "./deploy-controller-panel";
import { SettingsButton, SettingsInput } from "./settings-ui";

export type ControllerUpdate = SavedController & { apiKey?: string; clearApiKey?: boolean };

export function AdvancedControllerSettings({
  controllers,
  activeUrl,
  saving,
  onUpdate,
  onActivate,
  onDeployed,
}: {
  controllers: SavedController[];
  activeUrl: string;
  saving: boolean;
  onUpdate: (controllers: ControllerUpdate[]) => Promise<boolean>;
  onActivate: (controller: SavedController) => Promise<boolean>;
  onDeployed: (controller: DeployedController) => Promise<void>;
}) {
  const [draft, setDraft] = useState({ name: "", url: "", apiKey: "" });

  const addController = async () => {
    const url = normalizeControllerUrl(draft.url);
    if (!url || controllers.some((controller) => normalizeControllerUrl(controller.url) === url)) {
      return;
    }
    const saved = await onUpdate([
      ...controllers,
      {
        url,
        name: draft.name.trim() || undefined,
        apiKey: draft.apiKey.trim() || undefined,
      },
    ]);
    if (saved) setDraft({ name: "", url: "", apiKey: "" });
  };

  return (
    <>
      {controllers.map((controller, index) => (
        <ControllerRow
          key={normalizeControllerUrl(controller.url)}
          controller={controller}
          index={index}
          active={normalizeControllerUrl(controller.url) === activeUrl}
          disabled={saving}
          onActivate={() => onActivate(controller)}
          onSave={(next) =>
            onUpdate(
              controllers.map((entry) =>
                normalizeControllerUrl(entry.url) === normalizeControllerUrl(controller.url)
                  ? next
                  : entry,
              ),
            )
          }
          onRemove={() =>
            onUpdate(
              controllers.filter(
                (entry) =>
                  normalizeControllerUrl(entry.url) !== normalizeControllerUrl(controller.url),
              ),
            )
          }
        />
      ))}
      <div className="grid gap-2 px-4 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)_12rem_auto]">
        <SettingsInput
          value={draft.name}
          placeholder="Name"
          onChange={(name) => setDraft((current) => ({ ...current, name }))}
        />
        <SettingsInput
          value={draft.url}
          placeholder="http://host:port"
          onChange={(url) => setDraft((current) => ({ ...current, url }))}
        />
        <SettingsInput
          type="password"
          value={draft.apiKey}
          placeholder="API key optional"
          onChange={(apiKey) => setDraft((current) => ({ ...current, apiKey }))}
        />
        <SettingsButton onClick={() => void addController()} disabled={saving || !draft.url.trim()}>
          <Plus className="h-3 w-3" />
          Add
        </SettingsButton>
      </div>
      <DeployControllerPanel onDeployed={(controller) => void onDeployed(controller)} />
    </>
  );
}

function ControllerRow({
  controller,
  index,
  active,
  disabled,
  onActivate,
  onSave,
  onRemove,
}: {
  controller: SavedController;
  index: number;
  active: boolean;
  disabled: boolean;
  onActivate: () => Promise<boolean>;
  onSave: (controller: ControllerUpdate) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [name, setName] = useState(controller.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);

  const save = async () => {
    const saved = await onSave({
      url: controller.url,
      name: name.trim() || undefined,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(clearApiKey ? { clearApiKey: true } : {}),
    });
    if (saved) {
      setApiKey("");
      setClearApiKey(false);
    }
  };

  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[auto_10rem_minmax(0,1fr)_12rem_auto] sm:items-center">
      <SettingsButton onClick={() => void onActivate()} disabled={disabled || active}>
        {active ? "Active" : "Use"}
      </SettingsButton>
      <SettingsInput value={name} placeholder={`Controller ${index + 1}`} onChange={setName} />
      <CensoredApiUrl className="truncate font-mono text-[length:var(--fs-xs)] text-(--dim)">
        {controller.url}
      </CensoredApiUrl>
      <SettingsInput
        type="password"
        value={apiKey}
        placeholder={controller.hasApiKey ? "Credential configured" : "API key optional"}
        onChange={(value) => {
          setApiKey(value);
          if (value) setClearApiKey(false);
        }}
      />
      <div className="flex items-center justify-end gap-1">
        {controller.hasApiKey ? (
          <SettingsButton
            onClick={() => {
              setApiKey("");
              setClearApiKey((value) => !value);
            }}
            disabled={disabled}
            tone={clearApiKey ? "danger" : "default"}
          >
            {clearApiKey ? "Keep key" : "Clear key"}
          </SettingsButton>
        ) : null}
        <SettingsButton onClick={() => void save()} disabled={disabled} title="Save controller">
          <Save className="h-3 w-3" />
        </SettingsButton>
        <SettingsButton
          onClick={() => void onRemove()}
          disabled={disabled || active}
          tone="danger"
          title={active ? "Activate another controller before removing this one" : "Remove"}
        >
          <Trash2 className="h-3 w-3" />
        </SettingsButton>
      </div>
    </div>
  );
}
