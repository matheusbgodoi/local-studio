import { Effect } from "effect";
import type { Automation } from "@shared/agent/automation";
import { listAutomations } from "./automation-api";

type DesktopNotifications = {
  notify(payload: { title: string; body: string }): Promise<boolean>;
};

const lastRunByAutomation = new Map<string, string | null>();
let timer: number | null = null;
let seeded = false;
let polling = false;

function desktopNotifications(): DesktopNotifications | null {
  const bridge = (globalThis as { localStudioDesktop?: unknown }).localStudioDesktop;
  return bridge && typeof (bridge as { notify?: unknown }).notify === "function"
    ? (bridge as DesktopNotifications)
    : null;
}

function notificationTitle(automation: Automation): string {
  return automation.lastRun?.outcome === "error"
    ? "An automation failed"
    : "An automation finished";
}

function announce(automation: Automation): void {
  const bridge = desktopNotifications();
  if (!bridge || document.hasFocus()) return;
  void bridge
    .notify({
      title: notificationTitle(automation),
      body: automation.name.trim() || "Untitled automation",
    })
    .catch(() => undefined);
}

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const automations = await Effect.runPromise(listAutomations());
    if (!seeded) {
      for (const automation of automations) {
        lastRunByAutomation.set(automation.id, automation.lastRun?.at ?? null);
      }
      seeded = true;
      return;
    }
    const liveIds = new Set<string>();
    for (const automation of automations) {
      liveIds.add(automation.id);
      const current = automation.lastRun?.at ?? null;
      const previous = lastRunByAutomation.get(automation.id) ?? null;
      lastRunByAutomation.set(automation.id, current);
      if (current && current !== previous) announce(automation);
    }
    for (const id of lastRunByAutomation.keys()) {
      if (!liveIds.has(id)) lastRunByAutomation.delete(id);
    }
  } catch {
    return;
  } finally {
    polling = false;
  }
}

export function startAutomationNotifications(): () => void {
  if (!desktopNotifications()) return () => undefined;
  if (timer !== null) return () => undefined;
  void poll();
  timer = window.setInterval(() => void poll(), 30_000);
  return () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    seeded = false;
    polling = false;
    lastRunByAutomation.clear();
  };
}
