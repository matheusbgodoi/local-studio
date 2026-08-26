import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { log } from "../helpers/logger";

export type TitleResult = { ok: true; title: string } | { ok: false; reason: string };

const PROBE_TIMEOUT_MS = 10_000;
const TITLE_TIMEOUT_MS = 20_000;
const EXCERPT_LIMIT = 6000;

function helperPath(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "speech", "LocalStudioTitle")
    : path.join(app.getAppPath(), "desktop", "speech", "LocalStudioTitle");
  return existsSync(candidate) ? candidate : null;
}

function runHelper(
  args: readonly string[],
  stdinText: string | null,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const helper = helperPath();
  if (!helper || process.platform !== "darwin") return Promise.resolve(null);

  return new Promise((resolve) => {
    const child = spawn(helper, args, { stdio: "pipe" });
    let settled = false;
    let buffer = "";
    const settle = (message: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(message);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const timer = setTimeout(() => settle(null), timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      try {
        settle(JSON.parse(line) as Record<string, unknown>);
      } catch {
        settle(null);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => log.info(`title helper: ${chunk.trim()}`));
    child.on("error", () => settle(null));
    child.on("close", () => settle(null));
    child.stdin.on("error", () => {});
    child.stdin.end(stdinText ?? "", "utf8");
  });
}

let probed: Promise<boolean> | null = null;

function probeTitleModel(locale: string): Promise<boolean> {
  probed ??= runHelper(["--probe", "--locale", locale], null, PROBE_TIMEOUT_MS).then((message) => {
    const available = message?.type === "probe" && message.available === true;
    if (!available) {
      log.info(`session titles unavailable: ${String(message?.reason ?? "no_probe_answer")}`);
    }
    return available;
  });
  return probed;
}

export async function generateSessionTitle(excerpt: string, locale: string): Promise<TitleResult> {
  const trimmed = excerpt.trim().slice(0, EXCERPT_LIMIT);
  if (!trimmed) return { ok: false, reason: "empty_excerpt" };
  if (!(await probeTitleModel(locale))) return { ok: false, reason: "model_unavailable" };

  const message = await runHelper(["--title", "--locale", locale], trimmed, TITLE_TIMEOUT_MS);
  if (!message) return { ok: false, reason: "no_answer" };
  if (message.type === "title" && typeof message.title === "string" && message.title.trim()) {
    return { ok: true, title: message.title.trim() };
  }
  return { ok: false, reason: String(message.code ?? "no_title") };
}
