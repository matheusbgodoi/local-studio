import type { DesktopUpdateSnapshot } from "./types";
import type {
  DictationShortcutMode,
  DictationShortcutRequest,
  DictationShortcutResult,
  DictationShortcutState,
} from "./dictation-shortcut-contract";

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
}

export type SessionPrefsPayload = Record<
  string,
  { title?: string; pinned?: boolean; hidden?: boolean }
>;

export type UiPreferencesPayload = Record<string, string>;

export interface PtyStatus {
  available: boolean;
  reason: string | null;
}

export interface PtyOpenOpts {
  cwd?: string;
  cols?: number;
  rows?: number;
  ownerKey?: string;
}

export interface PtyBridge {
  status(): Promise<PtyStatus>;
  open(opts: PtyOpenOpts): Promise<{ id: string; replay?: string; reused?: boolean }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  closeOwner(ownerKey: string): Promise<void>;
  onData(listener: (id: string, chunk: string) => void): () => void;
  onExit(
    listener: (id: string, info: { exitCode: number; signal: number | null }) => void,
  ): () => void;
}

export interface QuickPanelHotkeyState {
  hotkey: string;
  defaultHotkey: string;
}

export interface QuickPanelHotkeyResult {
  ok: boolean;
  hotkey: string;
  error?: string;
}

export interface QuickPanelBridge {
  expand(): Promise<void>;
  dismiss(): Promise<void>;
  focusMainAndNavigate(projectId: string, sessionId?: string): Promise<void>;
  getHotkey(): Promise<QuickPanelHotkeyState>;
  setHotkey(hotkey: string): Promise<QuickPanelHotkeyResult>;
}

export type {
  DictationShortcutMode,
  DictationShortcutRequest,
  DictationShortcutResult,
  DictationShortcutState,
} from "./dictation-shortcut-contract";

export interface DictationShortcutBridge {
  get(): Promise<DictationShortcutState>;
  set(input: { mode: DictationShortcutMode; hotkey: string }): Promise<DictationShortcutResult>;
  registerTarget(ownerId: string, active: boolean): Promise<void>;
  reportRecording(ownerId: string, recording: boolean): Promise<void>;
  onRequest(listener: (request: DictationShortcutRequest) => void): () => void;
}

export interface ControllerDeployResultPayload {
  ok: boolean;
  url?: string;
  hasApiKey?: boolean;
  error?: string;
}

export interface ControllerDeployBridge {
  /** Deploy a controller to an ssh host. */
  start(options: {
    host: string;
    port?: number;
    installDir?: string;
  }): Promise<ControllerDeployResultPayload>;
  /** Streamed installer output lines for the in-flight deploy. */
  onLog(listener: (line: string) => void): () => void;
}

export interface KittylitterPairingResult {
  ok: boolean;
  pairingJson?: string;
  error?: string;
}

export interface KittylitterCopyResult {
  ok: boolean;
  error?: string;
}

export interface SaveTextFileRequest {
  defaultFileName: string;
  content: string;
}

export interface SaveTextFileResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

export type SessionTitleResult = { ok: true; title: string } | { ok: false; reason: string };

export interface RemoteAccessInfo {
  enabled: boolean;
  url: string | null;
  tokenAvailable: boolean;
}

/** On-device dictation. The audio never enters the renderer and never leaves the machine —
 *  the helper opens the microphone itself and only ever sends back text. */
export type DictationProbeResult = {
  available: boolean;
  locale?: string;
  localeMatch?: string;
  assetStatus?: string;
  reason?: string;
};

export type DictationBridgeEvent =
  | { type: "ready"; locale: string }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

export interface DesktopBridge {
  probeDictation(locale: string): Promise<DictationProbeResult>;
  startDictation(locale: string): Promise<{ started: boolean; reason?: string }>;
  stopDictation(mode: "stop" | "cancel"): Promise<{ ok: boolean }>;
  /** Returns its own unsubscribe. */
  onDictationEvent(listener: (event: DictationBridgeEvent) => void): () => void;
  getRuntime(): Promise<{
    platform: NodeJS.Platform;
    appVersion: string;
    packaged: boolean;
    releaseChannel: "dev" | "stable";
    distribution: "owner-fork";
    updatePolicy: "manual-merge" | "owner-feed";
    chromeVersion: string;
    electronVersion: string;
  }>;
  openExternal(url: string): Promise<boolean>;
  notify(payload: { title: string; body: string }): Promise<boolean>;
  /** Reveal a file in Finder/Explorer. Returns false when outside the home tree. */
  revealPath(target: string): Promise<boolean>;
  /** Open a file with its default application. False when outside the home tree. */
  openPath(target: string): Promise<boolean>;
  getUpdateStatus(): Promise<DesktopUpdateSnapshot>;
  startUpdate(): Promise<DesktopUpdateSnapshot>;
  openDirectory(): Promise<ProjectEntry | null>;
  saveTextFile(request: SaveTextFileRequest): Promise<SaveTextFileResult>;
  generateSessionTitle(excerpt: string, locale: string): Promise<SessionTitleResult>;
  getRemoteAccessInfo(): Promise<RemoteAccessInfo>;
  copyRemoteAccessToken(): Promise<{ ok: boolean }>;
  getPathForFile(file: File): string;
  listProjects(): Promise<ProjectEntry[]>;
  addProject(directoryPath: string): Promise<ProjectEntry>;
  removeProject(id: string): Promise<{ ok: true }>;
  /** Durable file-backed session prefs that survive process kill. */
  loadSessionPrefs(): Promise<SessionPrefsPayload>;
  saveSessionPrefs(prefs: SessionPrefsPayload): Promise<void>;
  /** Durable backup for renderer localStorage UI prefs (theme, font, layout). */
  loadUiPreferences(): Promise<UiPreferencesPayload>;
  saveUiPreferences(prefs: UiPreferencesPayload): Promise<void>;
  getKittylitterPairingJson(): Promise<KittylitterPairingResult>;
  copyKittylitterPairingJson(pairingJson: string): Promise<KittylitterCopyResult>;
  terminal: PtyBridge;
  quickPanel: QuickPanelBridge;
  dictationShortcut: DictationShortcutBridge;
  controllerDeploy: ControllerDeployBridge;
}
