"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusPill } from "@/ui";
import type { AgenticRunSnapshot, AgenticTask } from "@shared/agent/agentic-run";
import { isProtectedPolicy } from "@shared/agent/network-policy";
import { RunNetworkBadge } from "./run-network-badge";
import { eventLabel, formatTokens, humanStatus, runTone } from "./run-formatters";
import { useSessionRun } from "./use-session-run";

//
// The compact view of a Run, shown in the conversation that started it. It
// answers the question the owner actually has while work is happening — what
// did it decide to do, where is it, is it still going — without asking them to
// leave the chat or to micromanage anything. The deep view stays at /runs.
//

const MARK: Record<string, string> = {
  SUCCEEDED: "✓",
  RUNNING: "▶",
  FAILED: "✗",
  CANCELLED: "✗",
  BLOCKED: "•",
  WAITING_USER: "?",
};

function taskMark(task: AgenticTask): string {
  return MARK[task.status] ?? "○";
}

export function RunInlinePanel({
  sessionId,
  piSessionId,
}: {
  sessionId: string | null | undefined;
  piSessionId: string | null | undefined;
}) {
  const snapshot = useSessionRun(sessionId, piSessionId);
  if (!snapshot) return null;
  return <RunInlineBody snapshot={snapshot} />;
}

//
// How many task rows the strip shows before it starts hiding them.
//
// This panel sits directly above the composer, so its height is taken from the
// conversation. A twelve-task plan pushed the message the owner was reading off
// the screen. Collapsed, the strip stays about the size of the run it describes;
// the full plan is one click away here and always complete in the Run sidebar.
//
const COLLAPSED_TASKS = 3;

function RunInlineBody({ snapshot }: { snapshot: AgenticRunSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const { run, tasks, agents, events } = snapshot;
  const done = tasks.filter((task) => task.status === "SUCCEEDED").length;
  const agent = agents.find((entry) => entry.status === "WORKING") ?? agents[0];
  const latest = events[events.length - 1];
  //
  // Collapsed, it keeps whatever is actually happening rather than the first N
  // in plan order: the active task, the ones still to come, and enough finished
  // ones to show where the run has got to.
  //
  const activeIndex = Math.max(
    0,
    tasks.findIndex((task) => task.id === run.activeTaskId),
  );
  const window = Math.max(0, Math.min(activeIndex - 1, tasks.length - COLLAPSED_TASKS));
  const visibleTasks = expanded ? tasks : tasks.slice(window, window + COLLAPSED_TASKS);
  const hiddenCount = tasks.length - visibleTasks.length;

  return (
    <div className="mx-auto w-full max-w-(--composer-w) px-2 pb-1">
      <div className="rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={runTone(run.status)} variant="badge">
            {humanStatus(run.status)}
          </StatusPill>
          <span className="min-w-0 truncate text-[length:var(--fs-md)] text-(--ui-fg)">
            {run.goal}
          </span>
          <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">
            {done} / {tasks.length}
          </span>
          <div className="grow" />
          <Link
            href={`/runs?run=${encodeURIComponent(run.id)}`}
            className="text-[length:var(--fs-xs)] text-(--ui-muted) underline-offset-2 hover:underline"
          >
            Open run
          </Link>
        </div>

        <ul className="mt-1.5 space-y-0.5">
          {visibleTasks.map((task) => (
            <li key={task.id} className="flex items-baseline gap-2 text-[length:var(--fs-xs)]">
              <span className="w-3 shrink-0 text-(--ui-muted)">{taskMark(task)}</span>
              <span
                className={
                  task.status === "SUCCEEDED"
                    ? "min-w-0 truncate text-(--ui-muted) line-through"
                    : "min-w-0 truncate text-(--ui-fg)"
                }
              >
                {task.title}
              </span>
              {task.agentId ? (
                <span className="shrink-0 text-(--ui-muted)/70">
                  {agents.find((entry) => entry.id === task.agentId)?.name ?? ""}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 text-[length:var(--fs-xs)] text-(--ui-muted) underline-offset-2 hover:text-(--ui-fg) hover:underline"
          >
            {expanded
              ? "Show less"
              : `Show ${hiddenCount} more task${hiddenCount === 1 ? "" : "s"}`}
          </button>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
          {latest ? (
            <span className="min-w-0 truncate">
              {eventLabel(latest.type)}: {latest.summary}
            </span>
          ) : null}
          {isProtectedPolicy(run.networkPolicy) ? <RunNetworkBadge /> : null}
          <div className="grow" />
          <span className="font-mono">
            {formatTokens(agent?.activeContextTokens ?? 0)} /{" "}
            {formatTokens(agent?.contextLimit || run.usableLimit)}
          </span>
          <span>
            {run.compactionCount} compaction{run.compactionCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}
