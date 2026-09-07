"use client";

import { Download, RefreshCw } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { SettingsButton, SettingsGroup, SettingsRow, SettingsValue } from "./settings-ui";
import { useAppUpdate, type AppUpdate } from "@/features/shell/use-app-update";

function requestUpdate(update: AppUpdate, canRetry: boolean): void {
  if (canRetry) {
    update.startUpdate();
    return;
  }
  const version = update.latestVersion ? ` v${update.latestVersion}` : "";
  const ready = update.phase === "ready";
  const action = ready ? "restart CRIAs AI and install" : "download";
  const prompt = ready
    ? `Ready to ${action}${version} from the configured owner update feed? Installing will close and restart the app.`
    : `Ready to ${action}${version} from the configured owner update feed? Downloading does not restart the app; installation remains a separate confirmed step.`;
  if (window.confirm(prompt)) update.startUpdate();
}

function updateDescription(update: AppUpdate, progress: number | null): string {
  if (update.releaseChannel === "dev") return "Dev builds update through the local installer.";
  if (update.updatePolicy === "manual-merge") {
    return update.latestVersion
      ? `Customized owner build. Upstream v${update.latestVersion} is reference-only; updates are merged and rebuilt.`
      : "Customized owner build. Updates are merged into the owner fork and rebuilt.";
  }
  if (update.updateAvailable) {
    if (update.phase === "ready") {
      return `v${update.latestVersion} is downloaded — restart to finish updating.`;
    }
    if (update.status === "downloading") {
      return `Downloading v${update.latestVersion}${progress === null ? "." : ` — ${progress}%.`}`;
    }
    return `v${update.latestVersion} is available on the configured owner feed.`;
  }
  if (update.currentVersion && update.latestVersion) return "You are on the latest version.";
  return update.latestVersion
    ? `Latest release: v${update.latestVersion}.`
    : "Release check unavailable.";
}

function updateActionLabel(update: AppUpdate, canRetry: boolean, progress: number | null): string {
  if (canRetry) return "Retry check";
  if (update.status === "checking") return "Checking…";
  if (update.status === "downloading") {
    return progress === null ? "Downloading…" : `Downloading ${progress}%`;
  }
  return update.phase === "ready" ? "Restart to update" : "Download update";
}

export function AppVersionSection() {
  const update = useAppUpdate();
  const canRetry = update.updatePolicy === "owner-feed" && update.status === "error";
  const progress = update.progress === null ? null : Math.round(update.progress);
  const description = updateDescription(update, progress);
  return (
    <SettingsGroup title="Application" description="Version and updates.">
      <SettingsRow
        label="Version"
        description={description}
        value={
          <SettingsValue mono>
            {update.currentVersion ? `v${update.currentVersion}` : "Web UI"}
          </SettingsValue>
        }
        actions={
          update.updateAvailable || canRetry ? (
            <SettingsButton onClick={() => requestUpdate(update, canRetry)} tone="primary">
              {update.status === "checking" ? (
                <Spinner size="xs" />
              ) : update.phase === "ready" ? (
                <RefreshCw className="h-3 w-3" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {updateActionLabel(update, canRetry, progress)}
            </SettingsButton>
          ) : undefined
        }
      />
    </SettingsGroup>
  );
}
