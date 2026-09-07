export type DictationShortcutMode = "toggle" | "hold";

export interface DictationShortcutState {
  mode: DictationShortcutMode;
  hotkey: string;
  defaultHotkey: string;
  platform: NodeJS.Platform;
  readiness: "ready" | "permission_required" | "helper_missing" | "unsupported" | "error";
  active: boolean;
  inputMonitoring: boolean;
  accessibility: boolean;
  reason?: string;
}

export interface DictationShortcutResult extends DictationShortcutState {
  ok: boolean;
  error?: string;
}

export type DictationShortcutRequest = {
  ownerId: string;
  action: "start" | "stop";
};
