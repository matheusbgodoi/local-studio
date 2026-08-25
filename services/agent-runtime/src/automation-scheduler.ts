import {
  getAutomation,
  listAutomations,
  nextRunAt,
  patchAutomation,
  recordAutomationRun,
  type Automation,
} from "./automations-store";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { lastAssistantResult } from "./session-text";
import { listProjectsFromStore } from "./projects-store";
import { listConnectors } from "./connectors-service";
import { probeConnector } from "./connector-pool";
import { isPersonalConnectorId } from "../../../shared/agent/personal-connectors";
import type { PiAgentSession } from "./pi-runtime-types";

const TICK_MS = 30_000;

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: Set<string>;
};

function state(): SchedulerState {
  return getGlobalSingleton("automationScheduler", () => ({
    timer: null,
    running: new Set<string>(),
  }));
}

function runPrompt(automation: Automation): string {
  const preamble = automation.lastRun?.summary
    ? `Previous run summary (context, may be stale):\n${automation.lastRun.summary}\n\n---\n\n`
    : "";
  return `${preamble}${automation.prompt}`;
}

export function automationRunError(lastError: string | null, summary: string): string | null {
  if (lastError) return lastError;
  return summary.trim() ? null : "Automation completed without an assistant response.";
}

async function preflightRequiredConnectors(automation: Automation): Promise<string[]> {
  if (automation.requiredConnectorIds.length === 0) return [];
  const configured = new Map(
    (await listConnectors()).map((connector) => [connector.id, connector]),
  );
  const personal: string[] = [];
  for (const id of automation.requiredConnectorIds) {
    const connector = configured.get(id);
    if (!connector) throw new Error(`Required connection "${id}" is not configured.`);
    if (!connector.enabled) throw new Error(`Required connection "${connector.name}" is disabled.`);
    const probe = await probeConnector(connector);
    if (!probe.ok) {
      throw new Error(`Required connection "${connector.name}" is unavailable.`);
    }
    if (probe.tools.length === 0) {
      throw new Error(`Required connection "${connector.name}" reported no tools.`);
    }
    if (isPersonalConnectorId(id)) personal.push(id);
  }
  return personal;
}

export async function runAutomationNow(id: string): Promise<Automation | null> {
  const scheduler = state();
  const automation = await getAutomation(id);
  if (!automation || scheduler.running.has(id)) return null;
  scheduler.running.add(id);
  const runtimeSessionId = `automation:${id}:${Date.now()}`;
  let session: PiAgentSession | null = null;
  try {
    const personalConnectors = await preflightRequiredConnectors(automation);
    session = piRuntimeManager.getSessionForLookup(runtimeSessionId, null).session;
    await session.ensureStarted(automation.modelId, automation.cwd || undefined, null, {});
    const connectorSelection = await session.setConnectorSelection(personalConnectors);
    const connectorErrors = Object.values(connectorSelection.errors);
    if (connectorErrors.length > 0) {
      throw new Error("A required connection could not be activated for this automation.");
    }
    await session.prompt(runPrompt(automation), () => {}, {
      inferencePriority: "background",
    });
    const status = session.status;
    const piSessionId = status.piSessionId;
    const result = piSessionId
      ? lastAssistantResult(status.cwd, piSessionId)
      : { text: "", error: null };
    const error = automationRunError(status.lastError ?? result.error, result.text);
    const projectId =
      listProjectsFromStore().find((project) => project.path === status.cwd)?.id ?? null;
    return await recordAutomationRun(
      id,
      {
        at: new Date().toISOString(),
        piSessionId,
        cwd: status.cwd,
        projectId,
        outcome: error ? "error" : "ok",
        summary: result.text,
        ...(error ? { error } : {}),
      },
      nextRunAt(automation.schedule, new Date()).toISOString(),
    );
  } catch (error) {
    return await recordAutomationRun(
      id,
      {
        at: new Date().toISOString(),
        piSessionId: null,
        cwd: automation.cwd,
        projectId: null,
        outcome: "error",
        summary: "",
        error: error instanceof Error ? error.message : "Automation run failed",
      },
      nextRunAt(automation.schedule, new Date()).toISOString(),
    );
  } finally {
    await session?.stop().catch(() => undefined);
    scheduler.running.delete(id);
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  let automations: Automation[];
  try {
    automations = await listAutomations();
  } catch {
    return;
  }
  for (const automation of automations) {
    if (automation.status !== "active") continue;
    if (!automation.nextRunAt) {
      await patchAutomation(automation.id, {
        nextRunAt: nextRunAt(automation.schedule, now).toISOString(),
      }).catch(() => undefined);
      continue;
    }
    if (new Date(automation.nextRunAt) <= now) {
      void runAutomationNow(automation.id);
    }
  }
}

export function startAutomationScheduler(): void {
  const scheduler = state();
  if (scheduler.timer) return;
  scheduler.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}
