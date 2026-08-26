import {
  getAutomation,
  listAutomations,
  nextRunAt,
  patchAutomation,
  recordAutomationRun,
  type Automation,
  type AutomationRun,
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
import { withAutomationMutationLock } from "./automation-mutation-lock";

const TICK_MS = 30_000;
const SETTLEMENT_RETRY_DELAYS_MS = [250, 1_000, 5_000, 15_000, 30_000] as const;

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: Set<string>;
  executions: Map<string, Promise<void>>;
};

function state(): SchedulerState {
  return getGlobalSingleton("automationScheduler", () => ({
    timer: null,
    running: new Set<string>(),
    executions: new Map<string, Promise<void>>(),
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

type AutomationRunClaim = {
  automation: Automation;
  startedAt: string;
  trigger: AutomationRunTrigger;
};

export type AutomationStartResult = "started" | "missing" | "busy";

async function claimAutomationRun(
  id: string,
  trigger: AutomationRunTrigger,
): Promise<AutomationRunClaim | AutomationStartResult> {
  const scheduler = state();
  return withAutomationMutationLock(id, async () => {
    if (scheduler.running.has(id)) return "busy";
    const automation = await getAutomation(id);
    if (!automation) return "missing";
    if (automation.activeRun) return "busy";
    const startedAt = new Date().toISOString();
    scheduler.running.add(id);
    try {
      const started = await patchAutomation(id, { activeRun: { startedAt, trigger } });
      if (!started) {
        scheduler.running.delete(id);
        return "missing";
      }
      return { automation, startedAt, trigger };
    } catch (error) {
      scheduler.running.delete(id);
      throw error;
    }
  });
}

async function executeAutomationRun(claim: AutomationRunClaim): Promise<void> {
  const { automation, startedAt, trigger } = claim;
  const id = automation.id;
  const runtimeSessionId = `automation:${id}:${Date.now()}`;
  let session: PiAgentSession | null = null;
  let run: AutomationRun;
  try {
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
    run = {
      at: new Date().toISOString(),
      startedAt,
      trigger,
      piSessionId,
      cwd: status.cwd,
      projectId,
      outcome: error ? "error" : "ok",
      summary: result.text,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    run = {
      at: new Date().toISOString(),
      startedAt,
      trigger,
      piSessionId: null,
      cwd: automation.cwd,
      projectId: null,
      outcome: "error",
      summary: "",
      error: error instanceof Error ? error.message : "Automation run failed",
    };
  } finally {
    await session?.stop().catch(() => undefined);
    if (session) {
      try {
        piRuntimeManager.releaseSession(runtimeSessionId, session);
      } catch {
        console.error(`[automations] session cleanup failed id=${id}`);
      }
    }
  }
  await persistAutomationRun(id, run);
}

function retryDelay(attempt: number): number {
  return SETTLEMENT_RETRY_DELAYS_MS[Math.min(attempt - 1, SETTLEMENT_RETRY_DELAYS_MS.length - 1)];
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function reportPersistenceRetry(id: string, attempt: number, delayMs: number): void {
  if (attempt > SETTLEMENT_RETRY_DELAYS_MS.length && attempt % 10 !== 0) return;
  console.error(
    `[automations] result persistence failed id=${id} attempt=${attempt}; retrying in ${delayMs}ms`,
  );
}

async function persistAutomationRun(id: string, run: AutomationRun): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      const stored = await withAutomationMutationLock(id, async () => {
        const current = await getAutomation(id);
        if (!current) return true;
        const recorded = await recordAutomationRun(
          id,
          run,
          nextRunAt(current.schedule, new Date()).toISOString(),
        );
        return recorded !== null;
      });
      if (stored) return;
      throw new Error("Automation result was not stored.");
    } catch {
      attempt += 1;
      const delayMs = retryDelay(attempt);
      reportPersistenceRetry(id, attempt, delayMs);
      await waitForRetry(delayMs);
    }
  }
}

function superviseAutomationRun(claim: AutomationRunClaim): void {
  const scheduler = state();
  const id = claim.automation.id;
  const execution = executeAutomationRun(claim)
    .catch(() => {
      console.error(`[automations] supervised execution failed id=${id}`);
    })
    .finally(() => {
      scheduler.running.delete(id);
      scheduler.executions.delete(id);
    });
  scheduler.executions.set(id, execution);
  void execution;
}

export async function startAutomationRun(
  id: string,
  trigger: AutomationRunTrigger = "manual",
): Promise<AutomationStartResult> {
  const claimed = await claimAutomationRun(id, trigger);
  if (typeof claimed === "string") return claimed;
  superviseAutomationRun(claimed);
  return "started";
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
      await withAutomationMutationLock(automation.id, async () => {
        const current = await getAutomation(automation.id);
        if (!current || current.status !== "active" || current.nextRunAt) return;
        await patchAutomation(automation.id, {
          nextRunAt: nextRunAt(current.schedule, now).toISOString(),
        });
      }).catch(() => undefined);
      continue;
    }
    if (new Date(automation.nextRunAt) <= now) {
      void startAutomationRun(automation.id, "scheduled").catch(() => undefined);
    }
  }
}

async function recoverInterruptedRuns(): Promise<void> {
  const now = new Date();
  let automations: Automation[];
  let attempt = 0;
  while (true) {
    try {
      automations = await listAutomations();
      break;
    } catch {
      attempt += 1;
      const delayMs = retryDelay(attempt);
      reportPersistenceRetry("recovery-list", attempt, delayMs);
      await waitForRetry(delayMs);
    }
  }
  for (const automation of automations) {
    if (!automation.activeRun) continue;
    const scheduler = state();
    scheduler.running.add(automation.id);
    const recovery = persistAutomationRun(automation.id, {
      at: now.toISOString(),
      startedAt: automation.activeRun.startedAt,
      trigger: "recovered",
      piSessionId: null,
      cwd: automation.cwd,
      projectId: null,
      outcome: "error",
      summary: "",
      error: "The runtime stopped before this automation recorded a result.",
    }).finally(() => {
      scheduler.running.delete(automation.id);
      scheduler.executions.delete(automation.id);
    });
    scheduler.executions.set(automation.id, recovery);
    void recovery;
  }
}

async function startScheduler(): Promise<void> {
  void recoverInterruptedRuns();
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
