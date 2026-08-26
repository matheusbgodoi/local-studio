"use client";

import { useState } from "react";
import type {
  DictationShortcutBridge,
  DictationShortcutMode,
  DictationShortcutState,
} from "../../../desktop/interfaces";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { acceleratorFromEvent, HotkeyKeys } from "./quick-panel-settings";
import { SettingsButton, SettingsGroup, SettingsNotice, SettingsRow } from "./settings-ui";

function bridge(): DictationShortcutBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = window.localStudioDesktop?.dictationShortcut;
  return candidate ?? null;
}

function readinessLabel(state: DictationShortcutState): string {
  if (state.readiness === "ready") return "Ready";
  if (state.readiness === "permission_required") return "Permission required";
  if (state.readiness === "helper_missing") return "Helper missing";
  if (state.readiness === "unsupported") return "Unavailable on this platform";
  return "Unavailable";
}

export function DictationShortcutSettings() {
  const [state, setState] = useState<DictationShortcutState | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useMountSubscription(() => {
    let cancelled = false;
    const api = bridge();
    if (!api) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    void api
      .get()
      .then((loaded) => {
        if (!cancelled) setState(loaded);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = (mode: DictationShortcutMode, hotkey: string) => {
    const api = bridge();
    if (!api) return;
    setSaved(false);
    setError("");
    void api
      .set({ mode, hotkey })
      .then((result) => {
        setState(result);
        if (result.ok) {
          setSaved(true);
        } else {
          setError(result.error ?? result.reason ?? "Could not activate the shortcut");
        }
      })
      .catch((cause: unknown) => {
        setSaved(false);
        setError(
          cause instanceof Error
            ? `Dictation shortcut was not changed: ${cause.message}`
            : "Dictation shortcut was not changed. Reopen Settings and try again.",
        );
      });
  };

  useMountSubscription(() => {
    if (!capturing || !state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(false);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return;
      setCapturing(false);
      save(state.mode, accelerator);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, state]);

  useMountSubscription(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2_000);
    return () => clearTimeout(timer);
  }, [saved]);

  return (
    <SettingsGroup
      title="Dictation shortcut"
      description="Start on-device transcription from anywhere and send it only to the focused composer."
    >
      {available === false ? (
        <div className="px-3 py-2">
          <SettingsNotice tone="default">
            Global dictation is available in the CRIAs AI desktop app on macOS.
          </SettingsNotice>
        </div>
      ) : (
        <>
          <SettingsRow
            label="Activation"
            description={
              state?.mode === "hold"
                ? "Hold the combination while speaking; releasing it stops transcription."
                : "Press once to start and once again to stop."
            }
            value={
              <div className="flex items-center gap-1">
                {(["toggle", "hold"] as const).map((mode) => (
                  <SettingsButton
                    key={mode}
                    tone={state?.mode === mode ? "primary" : "default"}
                    disabled={!state}
                    onClick={() => state && save(mode, state.hotkey)}
                  >
                    {mode === "toggle" ? "Toggle" : "Hold to talk"}
                  </SettingsButton>
                ))}
              </div>
            }
          />
          <SettingsRow
            label="Global hotkey"
            description="This combination cannot also be assigned to the Quick Panel."
            value={
              capturing ? (
                <span className="text-[length:var(--fs-sm)] text-(--ui-accent)">
                  Press a key combination… (Esc to cancel)
                </span>
              ) : state ? (
                <HotkeyKeys accelerator={state.hotkey} />
              ) : (
                <span className="text-(--ui-muted)">Loading…</span>
              )
            }
            actions={
              <div className="flex items-center gap-1">
                {saved ? (
                  <span className="px-1 text-[length:var(--fs-xs)] text-(--ui-success)">Saved</span>
                ) : null}
                <SettingsButton onClick={() => setCapturing((value) => !value)} disabled={!state}>
                  {capturing ? "Cancel" : "Change"}
                </SettingsButton>
                {state && state.hotkey !== state.defaultHotkey ? (
                  <SettingsButton onClick={() => save(state.mode, state.defaultHotkey)}>
                    Reset
                  </SettingsButton>
                ) : null}
              </div>
            }
          />
          <SettingsRow
            label="Readiness"
            description={state?.reason}
            value={state ? readinessLabel(state) : "Checking…"}
          />
          {state?.platform === "darwin" ? (
            <SettingsRow
              label="macOS permissions"
              description="Hold-to-talk listens only for this combination. Enable CRIAs AI under System Settings → Privacy & Security → Input Monitoring or Accessibility, then reopen the app."
              value={
                <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">
                  Input Monitoring {state.inputMonitoring ? "on" : "off"} · Accessibility{" "}
                  {state.accessibility ? "on" : "off"}
                </span>
              }
            />
          ) : null}
          {error ? (
            <div className="px-3 py-2">
              <SettingsNotice tone="danger">{error}</SettingsNotice>
            </div>
          ) : null}
        </>
      )}
    </SettingsGroup>
  );
}
