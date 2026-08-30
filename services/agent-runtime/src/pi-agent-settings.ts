import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COMPACTION_KEEP_RECENT_TOKENS,
  LOCAL_BACKEND_HTTP_IDLE_TIMEOUT_MS,
  compactionReserveTokens,
} from "../../../shared/agent/context-headroom";

type PiAgentSettings = Record<string, unknown> & {
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
  };
  httpIdleTimeoutMs?: number | string;
};

async function readSettings(settingsPath: string): Promise<PiAgentSettings> {
  try {
    const raw = await readFile(settingsPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as PiAgentSettings) : {};
  } catch {
    return {};
  }
}

function nextHttpIdleTimeoutMs(current: number | string | undefined): number | undefined {
  if (typeof current === "string") return undefined;
  if (typeof current === "number" && current === 0) return undefined;
  if (typeof current === "number" && current >= LOCAL_BACKEND_HTTP_IDLE_TIMEOUT_MS) {
    return undefined;
  }
  return LOCAL_BACKEND_HTTP_IDLE_TIMEOUT_MS;
}

export async function applyContextHeadroomSettings(
  agentDir: string,
  contextWindow: number | null | undefined,
): Promise<{ reserveTokens: number; httpIdleTimeoutMs: number | null }> {
  const settingsPath = path.join(agentDir, "settings.json");
  const current = await readSettings(settingsPath);
  const reserveTokens = compactionReserveTokens(contextWindow);
  const timeout = nextHttpIdleTimeoutMs(current.httpIdleTimeoutMs);

  const compaction = {
    ...current.compaction,
    enabled: current.compaction?.enabled ?? true,
    reserveTokens,
    keepRecentTokens: current.compaction?.keepRecentTokens ?? COMPACTION_KEEP_RECENT_TOKENS,
  };

  const unchanged =
    current.compaction?.reserveTokens === reserveTokens &&
    current.compaction?.enabled === compaction.enabled &&
    current.compaction?.keepRecentTokens === compaction.keepRecentTokens &&
    timeout === undefined;
  if (unchanged) {
    return {
      reserveTokens,
      httpIdleTimeoutMs:
        typeof current.httpIdleTimeoutMs === "number" ? current.httpIdleTimeoutMs : null,
    };
  }

  const next: PiAgentSettings = {
    ...current,
    compaction,
    ...(timeout === undefined ? {} : { httpIdleTimeoutMs: timeout }),
  };

  await mkdir(agentDir, { recursive: true });
  const staging = `${settingsPath}.crias-${process.pid}`;
  await writeFile(staging, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  await chmod(staging, 0o600).catch(() => undefined);
  await rename(staging, settingsPath);

  const applied = next.httpIdleTimeoutMs;
  return {
    reserveTokens,
    httpIdleTimeoutMs: typeof applied === "number" ? applied : null,
  };
}
