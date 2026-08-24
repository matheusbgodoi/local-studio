//
// The model's `bash` tool, which is the widest egress surface in the product.
//
// It does not go through this runtime's PTY service. The coding SDK spawns the
// shell itself and, on Unix, resolves it by hardcoding /bin/bash — there is no
// environment variable that redirects it and no spawn hook reachable from here,
// because createAgentSessionServices does not forward tool options.
//
// Its one supported seam is `shellPath` in the agent's own settings.json, which
// Local Studio owns: PI_CODING_AGENT_DIR points inside the app's user data, not
// at a personal pi install. So protection writes the jail shim there and Direct
// removes it again.
//
// This is applied at runtime start, and `networkPolicy` is part of the runtime
// fingerprint, so flipping the toggle tears the runtime down and rebuilds it
// with the other shell rather than leaving a live session on the stale one.
//

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Settings = Record<string, unknown>;

function readSettings(filepath: string): Settings {
  if (!existsSync(filepath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(filepath, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Settings) : {};
  } catch {
    //
    // An unreadable settings file is left alone rather than replaced. Losing an
    // owner's configuration to make room for a shell path would be a worse
    // outcome than protection failing loudly, which is what the caller reports.
    //
    return {};
  }
}

//
// Returns whether the shell the agent will use is the jailed one, so the caller
// can refuse to claim protection if this could not be applied.
//
export function applyAgentShell(agentDir: string, shimPath: string | null): boolean {
  const filepath = path.join(agentDir, "settings.json");
  const settings = readSettings(filepath);
  const current = typeof settings.shellPath === "string" ? settings.shellPath : null;
  const desired = shimPath;

  if (current === desired) return desired !== null;
  if (desired === null) delete settings.shellPath;
  else settings.shellPath = desired;

  try {
    mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    writeFileSync(filepath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  } catch {
    return false;
  }
  return desired !== null;
}
