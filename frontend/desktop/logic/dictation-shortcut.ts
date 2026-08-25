import { app, globalShortcut } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import type {
  DictationShortcutMode,
  DictationShortcutResult,
  DictationShortcutState,
} from "../dictation-shortcut-contract";
import { getStoredDictationShortcut, setStoredDictationShortcut } from "./desktop-settings";

type HoldProbe = {
  readiness: DictationShortcutState["readiness"];
  inputMonitoring: boolean;
  accessibility: boolean;
  reason?: string;
};

type Prepared = {
  child: ChildProcessWithoutNullStreams | null;
  cleanup: () => void;
  probe: HoldProbe;
};

let mode: DictationShortcutMode = DESKTOP_CONFIG.dictationShortcut.mode;
let hotkey = DESKTOP_CONFIG.dictationShortcut.hotkey;
let active = false;
let holdChild: ChildProcessWithoutNullStreams | null = null;
let action: ((pressed: boolean) => void) | null = null;
let lastProbe: HoldProbe = {
  readiness: process.platform === "darwin" ? "helper_missing" : "unsupported",
  inputMonitoring: false,
  accessibility: false,
};

function helperPath(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "speech", "LocalStudioDictationHotkey")
    : path.join(app.getAppPath(), "desktop", "speech", "LocalStudioDictationHotkey");
  return existsSync(candidate) ? candidate : null;
}

function readLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onLine(line);
      index = buffer.indexOf("\n");
    }
  });
}

function decodeProbe(message: Record<string, unknown>): HoldProbe {
  const inputMonitoring = message.inputMonitoring === true;
  const accessibility = message.accessibility === true;
  const rawReason = typeof message.reason === "string" ? message.reason : undefined;
  const readiness =
    message.ready === true
      ? "ready"
      : message.reason === "permission_required"
        ? "permission_required"
        : "error";
  return {
    readiness,
    inputMonitoring,
    accessibility,
    ...(rawReason
      ? {
          reason:
            rawReason === "permission_required"
              ? "Enable Input Monitoring or Accessibility for Local Studio, then reopen the app."
              : rawReason,
        }
      : {}),
  };
}

function unavailableProbe(): HoldProbe | null {
  if (process.platform !== "darwin") {
    return {
      readiness: "unsupported",
      inputMonitoring: false,
      accessibility: false,
      reason: "Hold-to-talk is available only on macOS.",
    };
  }
  if (!helperPath()) {
    return {
      readiness: "helper_missing",
      inputMonitoring: false,
      accessibility: false,
      reason: "The hold-to-talk helper is not included in this build.",
    };
  }
  return null;
}

async function prepareHold(accelerator: string, listen: boolean): Promise<Prepared> {
  const unavailable = unavailableProbe();
  if (unavailable) return { child: null, cleanup: () => undefined, probe: unavailable };
  const helper = helperPath() as string;
  return new Promise((resolve) => {
    const child = spawn(helper, listen ? ["--accelerator", accelerator] : ["--probe"], {
      stdio: "pipe",
    });
    let settled = false;
    const finish = (probe: HoldProbe, keep: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!keep) child.kill();
      resolve({
        child: keep ? child : null,
        cleanup: () => child.kill(),
        probe,
      });
    };
    readLines(child.stdout, (line) => {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.type === "probe") finish(decodeProbe(message), false);
        if (message.type === "ready") finish(decodeProbe(message), true);
        if (message.type === "error") finish(decodeProbe(message), false);
        if (listen && message.type === "down") action?.(true);
        if (listen && message.type === "up") action?.(false);
      } catch {
        return;
      }
    });
    child.on("error", () =>
      finish(
        {
          readiness: "error",
          inputMonitoring: false,
          accessibility: false,
          reason: "The hold-to-talk helper could not start.",
        },
        false,
      ),
    );
    child.on("close", () => {
      if (holdChild === child) {
        holdChild = null;
        active = false;
        lastProbe = { ...lastProbe, readiness: "error", reason: "The hotkey listener stopped." };
      }
    });
    const timer = setTimeout(
      () =>
        finish(
          {
            readiness: "error",
            inputMonitoring: false,
            accessibility: false,
            reason: "The hold-to-talk helper did not become ready.",
          },
          false,
        ),
      3_000,
    );
  });
}

function state(probe = lastProbe): DictationShortcutState {
  return {
    mode,
    hotkey,
    defaultHotkey: DESKTOP_CONFIG.dictationShortcut.hotkey,
    platform: process.platform,
    readiness: mode === "toggle" && active ? "ready" : probe.readiness,
    active,
    inputMonitoring: probe.inputMonitoring,
    accessibility: probe.accessibility,
    ...(probe.reason ? { reason: probe.reason } : {}),
  };
}

function cleanupCurrent(): void {
  if (mode === "toggle" && active) globalShortcut.unregister(hotkey);
  holdChild?.kill();
  holdChild = null;
  active = false;
}

async function activate(nextMode: DictationShortcutMode, nextHotkey: string): Promise<Prepared> {
  if (nextMode === "toggle") {
    let registered = false;
    try {
      registered = globalShortcut.register(nextHotkey, () => action?.(true));
    } catch {
      registered = false;
    }
    return {
      child: null,
      cleanup: () => {
        if (registered) globalShortcut.unregister(nextHotkey);
      },
      probe: registered
        ? {
            readiness: "ready",
            inputMonitoring: lastProbe.inputMonitoring,
            accessibility: lastProbe.accessibility,
          }
        : {
            readiness: "error",
            inputMonitoring: lastProbe.inputMonitoring,
            accessibility: lastProbe.accessibility,
            reason: `Could not register "${nextHotkey}".`,
          },
    };
  }
  return prepareHold(nextHotkey, true);
}

export async function initializeDictationShortcut(
  onAction: (pressed: boolean) => void,
  quickPanelHotkey: string,
): Promise<void> {
  action = onAction;
  const stored = getStoredDictationShortcut();
  mode = stored.mode ?? DESKTOP_CONFIG.dictationShortcut.mode;
  hotkey = stored.hotkey ?? DESKTOP_CONFIG.dictationShortcut.hotkey;
  if (hotkey === quickPanelHotkey) {
    lastProbe = {
      ...lastProbe,
      readiness: "error",
      reason: "Shortcut conflicts with Quick Panel.",
    };
    return;
  }
  const prepared = await activate(mode, hotkey);
  lastProbe = prepared.probe;
  if (prepared.probe.readiness !== "ready") return;
  holdChild = prepared.child;
  active = true;
}

export async function getDictationShortcutState(): Promise<DictationShortcutState> {
  if (mode !== "hold") {
    const prepared = await prepareHold(hotkey, false);
    lastProbe = prepared.probe;
  }
  return state();
}

export async function setDictationShortcut(
  input: { mode: DictationShortcutMode; hotkey: string },
  quickPanelHotkey: string,
): Promise<DictationShortcutResult> {
  const nextHotkey = input.hotkey.trim();
  if (!nextHotkey) return { ...state(), ok: false, error: "Hotkey is required." };
  if (nextHotkey === quickPanelHotkey) {
    return { ...state(), ok: false, error: "That hotkey is assigned to Quick Panel." };
  }
  if (input.mode === mode && nextHotkey === hotkey && active) {
    setStoredDictationShortcut(hotkey, mode);
    return { ...state(), ok: true };
  }
  const prepared = await activate(input.mode, nextHotkey);
  if (prepared.probe.readiness !== "ready") {
    prepared.cleanup();
    return {
      ...state(prepared.probe),
      ok: false,
      error: prepared.probe.reason ?? "The shortcut could not be activated.",
    };
  }
  cleanupCurrent();
  mode = input.mode;
  hotkey = nextHotkey;
  holdChild = prepared.child;
  active = true;
  lastProbe = prepared.probe;
  setStoredDictationShortcut(hotkey, mode);
  return { ...state(), ok: true };
}

export function dictationShortcutHotkey(): string {
  return hotkey;
}

export function dictationShortcutMode(): DictationShortcutMode {
  return mode;
}

export function stopDictationShortcut(): void {
  cleanupCurrent();
  action = null;
}
