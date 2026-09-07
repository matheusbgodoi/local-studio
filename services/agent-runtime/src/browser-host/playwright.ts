import { finishBrowserCleanup } from "./cleanup";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { resolveDataDir } from "../data-dir";
import { getGlobalSingleton } from "../instances";
import { networkService } from "../network";

const LAUNCH_TIMEOUT_MS = 15_000;

const browserDataDirectory = (): string => {
  const override = process.env.LOCAL_STUDIO_BROWSER_PROFILE_DIR?.trim();
  if (override) return override;
  try {
    const directory = path.join(resolveDataDir(), "browser-profile");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  } catch {
    return path.join(os.tmpdir(), "local-studio-browser-profile");
  }
};

const resolveOnPath = (binary: string): string | null => {
  try {
    const resolved = execFileSync("which", [binary], { encoding: "utf8" }).trim();
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const platformBrowserCandidates = (): string[] => {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Arc.app/Contents/MacOS/Arc",
      "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter((value): value is string => Boolean(value));
    const suffixes = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Google\\Chrome Beta\\Application\\chrome.exe",
      "Chromium\\Application\\chrome.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "Vivaldi\\Application\\vivaldi.exe",
    ];
    return roots.flatMap((root) => suffixes.map((suffix) => path.join(root, suffix)));
  }
  return [
    "chromium-browser",
    "chromium",
    "google-chrome-stable",
    "google-chrome",
    "brave-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "vivaldi-stable",
  ]
    .map(resolveOnPath)
    .filter((value): value is string => Boolean(value));
};

export const findBrowserBinary = (): string | null => {
  const override = process.env["LOCAL_STUDIO_CHROME_PATH"]?.trim();
  if (override) return existsSync(override) ? override : null;
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return bundled;
  return platformBrowserCandidates().find((candidate) => existsSync(candidate)) ?? null;
};

const managers = new Set<PlaywrightManager>();

export class PlaywrightManager {
  constructor(private readonly sessionId?: string) {}
  private context: BrowserContext | null = null;
  private launching: Promise<BrowserContext> | null = null;
  private headful = false;
  private temporaryProfile: string | null = null;
  private profileClosed = false;
  private stopping: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private removing: Promise<void> | null = null;

  isAvailable(): boolean {
    return findBrowserBinary() !== null;
  }

  isHeadful(): boolean {
    return this.headful;
  }

  profileDirectory(): string {
    if (this.sessionId?.startsWith("subagent:")) {
      this.temporaryProfile ??= mkdtempSync(path.join(os.tmpdir(), "local-studio-child-browser-"));
      return this.temporaryProfile;
    }
    return this.sessionId
      ? path.join(
          browserDataDirectory(),
          "sessions",
          createHash("sha256").update(this.sessionId).digest("hex"),
        )
      : browserDataDirectory();
  }

  async ensure(): Promise<BrowserContext> {
    if (this.stopping) await this.stopping;
    if (this.closing || this.removing)
      throw new Error("Browser is still closing; retry after cleanup completes");
    managers.add(this);
    if (this.context) return this.context;
    if (this.launching) return this.launching;
    const executablePath = findBrowserBinary();
    if (!executablePath) {
      throw new Error("Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH");
    }
    const headless = !this.headful;

    const network = networkService();
    const jailArgs = network.chromiumArguments();
    const launch = (userDataDir: string): Promise<BrowserContext> =>
      chromium.launchPersistentContext(userDataDir, {
        executablePath: network.chromiumExecutable(executablePath),
        headless,
        viewport: { width: 1280, height: 800 },
        timeout: LAUNCH_TIMEOUT_MS,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
          ...jailArgs,
        ],
        env: { ...process.env, ...network.environment() } as Record<string, string>,
        ...(network.proxyEndpoint()
          ? { proxy: { server: `socks5://${network.proxyEndpoint()}` } }
          : {}),
      });
    const dataDirectory = this.profileDirectory();
    this.profileClosed = false;
    this.launching = launch(dataDirectory)
      .catch((error: unknown) => {
        if (this.temporaryProfile || !String(error).includes("ProcessSingleton")) throw error;
        console.warn(
          "[browser] profile already in use; starting an isolated copy — verified sessions will not carry over",
        );
        return launch(`${dataDirectory}-${process.pid}`);
      })
      .then((context) => {
        this.context = context;
        context.once("close", () => {
          if (this.context === context) {
            this.profileClosed = true;
            this.context = null;
          }
        });
        return context;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  async setInteractive(headful: boolean): Promise<BrowserContext> {
    if (this.stopping) await this.stopping;
    if (this.closing || this.removing)
      throw new Error("Browser is still closing; retry after cleanup completes");
    if (this.headful === headful && this.context) return this.context;
    if (this.launching) await this.launching.catch(() => undefined);
    const previous = this.context;
    if (previous) await previous.close();
    this.context = null;
    this.headful = headful;
    return this.ensure();
  }

  stop(): Promise<void> {
    this.stopping ??= this.closeProfile().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  private async closeProfile(): Promise<void> {
    const pending = this.launching;
    if (pending && !(await finishBrowserCleanup("browser startup", () => pending))) return;
    if (this.closing) {
      const closing = this.closing;
      await finishBrowserCleanup("context closure", () => closing);
      return;
    }
    const context = this.context;
    if (context) {
      const closing = Promise.resolve()
        .then(() => context.close())
        .then(async () => {
          if (this.context === context) {
            this.profileClosed = true;
            this.context = null;
          }
          if (!this.context) await this.removeClosedProfile();
          managers.delete(this);
        })
        .catch(() => {
          if (!this.context || this.context === context) this.profileClosed = false;
          console.warn("[browser] close cleanup failed; child profile retained");
        })
        .finally(() => {
          if (this.closing === closing) this.closing = null;
        });
      this.closing = closing;
      await finishBrowserCleanup("context closure", () => closing);
      return;
    }
    await finishBrowserCleanup("temporary profile removal", () => this.removeClosedProfile());
    managers.delete(this);
  }

  private async removeClosedProfile(): Promise<void> {
    if (this.removing) return this.removing;
    const directory = this.temporaryProfile;
    if (!directory) return;
    if (!this.profileClosed || this.context) {
      console.warn("[browser] child profile retained because browser closure was not confirmed");
      return;
    }
    const removing = rm(directory, { recursive: true, force: true })
      .then(() => {
        if (this.temporaryProfile === directory) this.temporaryProfile = null;
      })
      .finally(() => {
        if (this.removing === removing) this.removing = null;
      });
    this.removing = removing;
    return removing;
  }
}

export const playwrightManager = getGlobalSingleton(
  "playwrightManager",
  () => new PlaywrightManager(),
);

getGlobalSingleton("playwrightExitHook", () => {
  if (typeof process !== "undefined") {
    process.on("exit", stopBrowserManagers);
  }
  return true;
});

export function stopBrowserManagers(): void {
  for (const manager of managers) void manager.stop();
}
