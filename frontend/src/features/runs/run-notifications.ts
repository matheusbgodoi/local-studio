//
// A native notification for the two moments worth interrupting someone for.
//
// The owner hands a goal to a durable Run and goes to do something else. There
// are exactly two things they want pulled back for: it finished, or it is stuck
// on an answer only they can give. Everything else a Run does — a task settling,
// a compaction, a plan revision — is progress they can read whenever they
// return, and a notification for it would be noise that teaches them to ignore
// the next one.
//
// Nothing here polls. It rides the same module-level Runs store the panels
// already subscribe to, so a machine with no Runs pays nothing for it.
//
// Two rules keep it from being annoying:
//
//   Only on a TRANSITION. The store re-publishes on every tick, and firing on
//   state rather than on change would notify once every couple of seconds for as
//   long as a Run sat finished.
//
//   Only when the window is not focused. If the owner is looking at the app,
//   the run panel already told them, and a notification on top of that is a
//   duplicate that interrupts someone who was not away.
//

import type { AgenticRun } from "@shared/agent/agentic-run";
import { getRunsState, subscribeRuns } from "./runs-store";
import { humanStatus } from "./run-formatters";

type Notifiable = "COMPLETED" | "FAILED" | "WAITING_USER";

const NOTIFY: ReadonlySet<string> = new Set<Notifiable>(["COMPLETED", "FAILED", "WAITING_USER"]);

//
// What each Run's status was the last time it was looked at. A Run that is
// already finished when the app opens must not fire — it is history, not news.
//
const lastStatus = new Map<string, string>();
let started = false;

function desktop(): { notify(payload: { title: string; body: string }): Promise<boolean> } | null {
  const bridge = (globalThis as { localStudioDesktop?: unknown }).localStudioDesktop;
  return bridge && typeof (bridge as { notify?: unknown }).notify === "function"
    ? (bridge as { notify(payload: { title: string; body: string }): Promise<boolean> })
    : null;
}

function shortGoal(run: AgenticRun): string {
  const goal = run.goal.trim();
  return goal.length > 140 ? `${goal.slice(0, 139)}…` : goal;
}

function titleFor(status: string): string {
  if (status === "WAITING_USER") return "Local Studio needs an answer";
  if (status === "FAILED") return "A run failed";
  return "A run finished";
}

function announce(run: AgenticRun): void {
  const bridge = desktop();
  if (!bridge) return;
  void bridge
    .notify({ title: titleFor(run.status), body: `${humanStatus(run.status)} — ${shortGoal(run)}` })
    .catch(() => undefined);
}

//
// Started once, from the workspace shell. Idempotent, because the shell can
// re-render and React strict mode runs effects twice.
//
export function startRunNotifications(): () => void {
  if (started) return () => undefined;
  started = true;

  //
  // Seed from whatever is already on screen WITHOUT notifying, so opening the
  // app to a Run that finished last night stays quiet.
  //
  for (const run of getRunsState().runs) lastStatus.set(run.id, run.status);

  const unsubscribe = subscribeRuns(() => {
    const focused = typeof document === "undefined" || document.hasFocus();
    const live = new Set<string>();
    for (const run of getRunsState().runs) {
      live.add(run.id);
      const previous = lastStatus.get(run.id);
      lastStatus.set(run.id, run.status);
      if (previous === undefined || previous === run.status) continue;
      if (!NOTIFY.has(run.status)) continue;
      if (focused) continue;
      announce(run);
    }
    //
    // A Run that left the list entirely is forgotten, so the map cannot grow
    // for the lifetime of the process.
    //
    for (const id of [...lastStatus.keys()]) if (!live.has(id)) lastStatus.delete(id);
  });

  return () => {
    unsubscribe();
    started = false;
    lastStatus.clear();
  };
}
