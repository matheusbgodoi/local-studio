import { app, BrowserWindow } from "electron";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import { readFrontendToken } from "./frontend-token";
import { log } from "../helpers/logger";
import { hardenWebContents, registerPermissionPolicy } from "./security";

async function memorySummary(): Promise<string> {
  try {
    const memory = await process.getProcessMemoryInfo();
    return `memory=${JSON.stringify(memory)}`;
  } catch {
    return "memory=unavailable";
  }
}

export function createMainWindow(appUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: DESKTOP_CONFIG.preferredWindow.width,
    height: DESKTOP_CONFIG.preferredWindow.height,
    minWidth: DESKTOP_CONFIG.minimumWindow.width,
    minHeight: DESKTOP_CONFIG.minimumWindow.height,
    backgroundColor: "#0b0f14",
    show: false,
    title: DESKTOP_CONFIG.appName,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      devTools: !process.env.LOCAL_STUDIO_DESKTOP_DISABLE_DEVTOOLS,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  const appOrigin = new URL(appUrl).origin;
  hardenWebContents(window, appOrigin);
  registerPermissionPolicy(window, appOrigin);

  let lastRendererReloadAt = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    void memorySummary().then((memory) => {
      log.error(
        [
          "Renderer process gone",
          `reason=${details.reason}`,
          `exitCode=${details.exitCode}`,
          `url=${window.webContents.getURL() || appUrl}`,
          `appVersion=${app.getVersion()}`,
          memory,
        ].join(" "),
      );
    });
    // Recover from a renderer crash (OOM/GPU/abnormal) by reloading, so the user
    // isn't left with a permanent blank window. Rate-limited so a hard crash-loop
    // doesn't spin — after that the window stays blank rather than thrashing.
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    const now = Date.now();
    if (now - lastRendererReloadAt < 10_000) return;
    lastRendererReloadAt = now;
    log.warn("Reloading window after renderer crash");
    window.webContents.reload();
  });

  window.once("ready-to-show", () => window.show());
  //
  // When the owner sets a frontend token, it applies to EVERY request — the
  // desktop window included, because the server cannot tell a request proxied
  // in by `tailscale serve` from one made by this window, and a Host header is
  // client-chosen. Seeding the cookie into this window's own session is what
  // lets the native app keep working while remote access stays gated.
  //
  //
  // Read from the same file the Next server's env is built from, not from this
  // process's environment: a GUI app does not inherit a shell, so the env var is
  // only ever set by the app itself and reading it here would be circular.
  //
  const token = readFrontendToken(DESKTOP_CONFIG.userDataDir);
  const load = (): void => {
    void window.loadURL(appUrl);
  };
  if (token) {
    void window.webContents.session.cookies
      .set({ url: appUrl, name: "local_studio_token", value: token, httpOnly: true, path: "/" })
      .then(load, load);
  } else {
    load();
  }

  return window;
}
