import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { log } from "../helpers/logger";

/**
 * On-device dictation, via a standalone Swift helper spawned over stdio.
 *
 * NOT a native Node addon: this repository has no node-gyp, no node-addon-api and no
 * electron-rebuild, and a helper talking JSON over a pipe needs none of them — nor does it have
 * to be rebuilt every time Electron moves. See the header of desktop/speech/LocalStudioDictation.swift.
 *
 * The audio never leaves the machine and never enters this process: the helper opens the
 * microphone itself and only ever writes text. That is the whole point of preferring it over the
 * upload path, which sends a recording to a backend.
 */

export type DictationEvent =
  | { type: "ready"; locale: string }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

export type DictationProbe = {
  available: boolean;
  locale?: string;
  localeMatch?: string;
  assetStatus?: string;
  reason?: string;
};

/** Where electron-builder puts the helper, and where it sits in a dev checkout. */
function helperPath(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "speech", "LocalStudioDictation")
    : path.join(app.getAppPath(), "desktop", "speech", "LocalStudioDictation");
  return existsSync(candidate) ? candidate : null;
}

/**
 * ONE MICROPHONE, ONE SESSION. Two live helpers would compete for the input device and
 * interleave their partials into the same composer span, which reads as the transcript
 * corrupting itself rather than as the bug it is.
 */
let active: ChildProcessWithoutNullStreams | null = null;

/** stdout is newline-delimited JSON. A chunk is not a line: a partial arriving mid-buffer must
 *  be held until its newline, or a long transcript is parsed as garbage exactly when it gets
 *  interesting. */
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

export async function probeDictation(locale: string): Promise<DictationProbe> {
  const helper = helperPath();
  if (!helper) return { available: false, reason: "helper_not_bundled" };
  if (process.platform !== "darwin") return { available: false, reason: "not_macos" };

  return new Promise<DictationProbe>((resolve) => {
    const child = spawn(helper, ["--probe", "--locale", locale], { stdio: "pipe" });
    let answered = false;
    const answer = (probe: DictationProbe) => {
      if (answered) return;
      answered = true;
      resolve(probe);
    };
    readLines(child.stdout, (line) => {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.type === "probe") {
          answer({
            available: message.assetStatus === "supported",
            locale: typeof message.locale === "string" ? message.locale : undefined,
            localeMatch: typeof message.match === "string" ? message.match : undefined,
            assetStatus: typeof message.assetStatus === "string" ? message.assetStatus : undefined,
          });
        } else if (message.type === "error") {
          answer({ available: false, reason: String(message.code ?? "probe_failed") });
        }
      } catch {
        // A line that is not JSON is the helper misbehaving, not a reason to crash the app.
      }
    });
    child.on("error", () => answer({ available: false, reason: "spawn_failed" }));
    // A probe that neither answers nor exits must not leave the button spinning forever.
    child.on("close", () => answer({ available: false, reason: "no_probe_answer" }));
  });
}

export function startDictation(
  locale: string,
  onEvent: (event: DictationEvent) => void,
): { started: boolean; reason?: string } {
  if (active) return { started: false, reason: "already_running" };
  const helper = helperPath();
  if (!helper) return { started: false, reason: "helper_not_bundled" };
  if (process.platform !== "darwin") return { started: false, reason: "not_macos" };

  const child = spawn(helper, ["--locale", locale], { stdio: "pipe" });
  active = child;

  readLines(child.stdout, (line) => {
    try {
      const message = JSON.parse(line) as DictationEvent;
      if (message && typeof message.type === "string") onEvent(message);
    } catch {
      log.warn("dictation: unparseable line from helper");
    }
  });
  // stderr is diagnostics by contract, never protocol. Logged, never surfaced as a transcript.
  readLines(child.stderr, (line) => log.info(`dictation helper: ${line}`));

  child.on("error", (error) => {
    active = null;
    onEvent({ type: "error", code: "spawn_failed", message: String(error) });
  });
  child.on("close", () => {
    // Always emit `done`, even on a crash. The renderer settles its pending span on it, and a
    // span left pending is text the user can see but cannot edit as ordinary input.
    if (active === child) active = null;
    onEvent({ type: "done" });
  });

  return { started: true };
}

/** `stop` keeps what was heard; `cancel` throws it away. Both let the helper release the
 *  microphone itself — killing it would leave the input device held until the process reaped. */
export function stopDictation(mode: "stop" | "cancel" = "stop"): void {
  const child = active;
  if (!child) return;
  try {
    child.stdin.write(`${mode}\n`);
  } catch {
    child.kill();
  }
}
