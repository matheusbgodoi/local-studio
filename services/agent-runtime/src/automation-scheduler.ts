import {
  getAutomation,
  listAutomations,
  nextRunAt,
  patchAutomation,
  recordAutomationRun,
  type Automation,
  type AutomationRunTrigger,
} from "./automations-store";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { lastAssistantResult } from "./session-text";
import { listProjectsFromStore } from "./projects-store";
import { listConnectors } from "./connectors-service";
import { allowedConnectorTools, probeConnector } from "./connector-pool";
import { qualifiedConnectorToolName } from "./connector-session-tools";
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

type RequiredConnectorPlan = {
  personal: string[];
  connectorNames: Map<string, string>;
  toolNames: Map<string, string[]>;
};

async function preflightRequiredConnectors(automation: Automation): Promise<RequiredConnectorPlan> {
  const plan: RequiredConnectorPlan = {
    personal: [],
    connectorNames: new Map(),
    toolNames: new Map(),
  };
  if (automation.requiredConnectorIds.length === 0) return plan;
  const configured = new Map(
    (await listConnectors()).map((connector) => [connector.id, connector]),
  );
  for (const id of automation.requiredConnectorIds) {
    const connector = configured.get(id);
    if (!connector) throw new Error(`Required connection "${id}" is not configured.`);
    if (!connector.enabled) throw new Error(`Required connection "${connector.name}" is disabled.`);
    const probe = await probeConnector(connector);
    if (!probe.ok) {
      throw new Error(`Required connection "${connector.name}" is unavailable.`);
    }
    const tools = allowedConnectorTools(connector, probe.tools);
    if (tools.length === 0) {
      throw new Error(`Required connection "${connector.name}" has no allowed tools.`);
    }
    plan.connectorNames.set(id, connector.name);
    plan.toolNames.set(
      id,
      tools.map((tool) => qualifiedConnectorToolName(id, tool.name)),
    );
    if (isPersonalConnectorId(id)) plan.personal.push(id);
  }
  return plan;
}

export async function runAutomationNow(
  id: string,
  trigger: AutomationRunTrigger = "manual",
): Promise<Automation | null> {
  const scheduler = state();
  if (scheduler.running.has(id)) return null;
  scheduler.running.add(id);
  const automation = await getAutomation(id);
  if (!automation || automation.activeRun) {
    scheduler.running.delete(id);
    return null;
  }
  const startedAt = new Date().toISOString();
  const runtimeSessionId = `automation:${id}:${Date.now()}`;
  let session: PiAgentSession | null = null;
  try {
    const started = await patchAutomation(id, { activeRun: { startedAt, trigger } });
    if (!started) return null;
    const connectorPlan = await preflightRequiredConnectors(automation);
    session = piRuntimeManager.getSessionForLookup(runtimeSessionId, null).session;
    await session.ensureStarted(automation.modelId, automation.cwd || undefined, null, {});
    const connectorSelection = await session.setConnectorSelection(connectorPlan.personal);
    const connectorErrors = Object.values(connectorSelection.errors);
    const missingPersonal = connectorPlan.personal.filter(
      (connectorId) => !connectorSelection.active.includes(connectorId),
    );
    if (connectorErrors.length > 0 || missingPersonal.length > 0) {
      throw new Error("A required connection could not be activated for this automation.");
    }
    const activeTools = new Set(session.getActiveToolNames());
    for (const [connectorId, toolNames] of connectorPlan.toolNames) {
      if (toolNames.every((name) => activeTools.has(name))) continue;
      const connectorName = connectorPlan.connectorNames.get(connectorId) ?? connectorId;
      throw new Error(`Required connection "${connectorName}" did not activate its tools.`);
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
        startedAt,
        trigger,
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
        startedAt,
        trigger,
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
    if (session) piRuntimeManager.releaseSession(runtimeSessionId, session);
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
      void runAutomationNow(automation.id, "scheduled");
    }
  }
}

async function recoverInterruptedRuns(): Promise<void> {
  const now = new Date();
  const automations = await listAutomations();
  for (const automation of automations) {
    if (!automation.activeRun) continue;
    await recordAutomationRun(
      automation.id,
      {
        at: now.toISOString(),
        startedAt: automation.activeRun.startedAt,
        trigger: "recovered",
        piSessionId: null,
        cwd: automation.cwd,
        projectId: null,
        outcome: "error",
        summary: "",
        error: "The runtime stopped before this automation recorded a result.",
      },
      nextRunAt(automation.schedule, now).toISOString(),
    );
  }
}

async function startScheduler(): Promise<void> {
  await recoverInterruptedRuns().catch(() => undefined);
  await tick();
}

export function startAutomationScheduler(): void {
  const scheduler = state();
  if (scheduler.timer) return;
  scheduler.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void startScheduler();
}
