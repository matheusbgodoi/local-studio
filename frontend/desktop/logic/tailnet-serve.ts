//
// Keeps `tailscale serve` pointed at the port the embedded server actually got.
//
// The port is persisted and normally stable, but it lives inside macOS's
// ephemeral range: a transient outbound connection can hold it at the moment we
// launch, and `resolveStablePort` then falls back to a different one. A serve
// config pinned to the old port does not error — it answers 502 to the phone,
// forever, with nothing on this machine indicating why. Re-pointing at every
// launch removes that failure mode entirely.
//
// It runs only when remote access is already on. This never enables serve and
// never chooses a hostname; it only corrects the port of a handler the owner
// deliberately created.
//

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { log } from "../helpers/logger";

const TAILSCALE_BINARIES = [
  "/usr/local/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

function tailscaleBinary(): string | null {
  return TAILSCALE_BINARIES.find((candidate) => existsSync(candidate)) ?? null;
}

function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 15_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

//
// Best-effort by design: a failure here means remote access keeps whatever
// configuration it had, which is the state the owner last chose. Throwing would
// take the whole app down over a feature they may not be using right now.
//
export async function repointTailnetServe(host: string, port: number): Promise<void> {
  const binary = tailscaleBinary();
  if (!binary) {
    log.warn(`Remote access is configured for ${host} but the tailscale CLI was not found`);
    return;
  }
  try {
    const current = await run(binary, ["serve", "status", "--json"]);
    if (current.includes(`http://127.0.0.1:${port}`)) return;
    await run(binary, ["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]);
    log.info(`Re-pointed tailscale serve for ${host} at 127.0.0.1:${port}`);
  } catch (error) {
    log.warn(`Could not re-point tailscale serve: ${String(error)}`);
  }
}
