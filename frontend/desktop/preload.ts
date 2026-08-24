import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopBridge, DictationBridgeEvent } from "./interfaces";

const bridge: DesktopBridge = {
  getRuntime: () => ipcRenderer.invoke("desktop:get-runtime"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload),
  revealPath: (target) => ipcRenderer.invoke("desktop:reveal-path", target),
  openPath: (target) => ipcRenderer.invoke("desktop:open-path", target),
  getUpdateStatus: () => ipcRenderer.invoke("desktop:get-update-status"),
  startUpdate: () => ipcRenderer.invoke("desktop:start-update"),
  openDirectory: () => ipcRenderer.invoke("desktop:open-directory"),
  saveTextFile: (request) => ipcRenderer.invoke("desktop:save-text-file", request),
  generateSessionTitle: (excerpt, locale) =>
    ipcRenderer.invoke("desktop:generate-session-title", excerpt, locale),
  getRemoteAccessInfo: () => ipcRenderer.invoke("desktop:get-remote-access-info"),
  copyRemoteAccessToken: () => ipcRenderer.invoke("desktop:copy-remote-access-token"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  probeDictation: (locale: string) => ipcRenderer.invoke("desktop:dictation-probe", locale),
  startDictation: (locale: string) => ipcRenderer.invoke("desktop:dictation-start", locale),
  stopDictation: (mode: "stop" | "cancel") => ipcRenderer.invoke("desktop:dictation-stop", mode),
  /** Returns its own unsubscribe. The listener is removed by identity, not by wiping every
   *  listener on the channel — a second composer would otherwise silence the first. */
  onDictationEvent: (listener: (event: DictationBridgeEvent) => void) => {
    const handler = (_: unknown, payload: DictationBridgeEvent) => listener(payload);
    ipcRenderer.on("desktop:dictation-event", handler);
    // Returns void, not the IpcRenderer that removeListener hands back, so the caller cannot
    // accidentally depend on the chainable object leaking across the context bridge.
    return () => {
      ipcRenderer.removeListener("desktop:dictation-event", handler);
    };
  },
  listProjects: () => ipcRenderer.invoke("desktop:list-projects"),
  addProject: (directoryPath) => ipcRenderer.invoke("desktop:add-project", directoryPath),
  removeProject: (id) => ipcRenderer.invoke("desktop:remove-project", id),
  loadSessionPrefs: () => ipcRenderer.invoke("desktop:load-session-prefs"),
  saveSessionPrefs: (prefs) => ipcRenderer.invoke("desktop:save-session-prefs", prefs),
  loadUiPreferences: () => ipcRenderer.invoke("desktop:load-ui-preferences"),
  saveUiPreferences: (prefs) => ipcRenderer.invoke("desktop:save-ui-preferences", prefs),
  getKittylitterPairingJson: () => ipcRenderer.invoke("desktop:get-kittylitter-pairing-json"),
  copyKittylitterPairingJson: (pairingJson) =>
    ipcRenderer.invoke("desktop:copy-kittylitter-pairing-json", pairingJson),
  terminal: {
    status: () => ipcRenderer.invoke("desktop:pty-status"),
    open: (opts) => ipcRenderer.invoke("desktop:pty-open", opts),
    write: (id, data) => ipcRenderer.invoke("desktop:pty-write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("desktop:pty-resize", id, cols, rows),
    close: (id) => ipcRenderer.invoke("desktop:pty-close", id),
    closeOwner: (ownerKey) => ipcRenderer.invoke("desktop:pty-close-owner", ownerKey),
    onData: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; chunk: string }) =>
        listener(payload.id, payload.chunk);
      ipcRenderer.on("desktop:pty-data", handler);
      return () => ipcRenderer.removeListener("desktop:pty-data", handler);
    },
    onExit: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; exitCode: number; signal: number | null },
      ) => listener(payload.id, { exitCode: payload.exitCode, signal: payload.signal });
      ipcRenderer.on("desktop:pty-exit", handler);
      return () => ipcRenderer.removeListener("desktop:pty-exit", handler);
    },
  },
  quickPanel: {
    expand: () => ipcRenderer.invoke("desktop:quick-panel-expand"),
    dismiss: () => ipcRenderer.invoke("desktop:quick-panel-dismiss"),
    focusMainAndNavigate: (projectId, sessionId) =>
      ipcRenderer.invoke("desktop:focus-main-and-navigate", projectId, sessionId),
    getHotkey: () => ipcRenderer.invoke("desktop:quick-panel-get-hotkey"),
    setHotkey: (hotkey) => ipcRenderer.invoke("desktop:quick-panel-set-hotkey", hotkey),
  },
  controllerDeploy: {
    start: (options) => ipcRenderer.invoke("desktop:controller-deploy", options),
    onLog: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { line: string }) =>
        listener(payload.line);
      ipcRenderer.on("desktop:controller-deploy-log", handler);
      return () => ipcRenderer.removeListener("desktop:controller-deploy-log", handler);
    },
  },
};

contextBridge.exposeInMainWorld("localStudioDesktop", bridge);
