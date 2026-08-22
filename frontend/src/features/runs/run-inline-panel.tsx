"use client";

import Link from "next/link";
import { StatusPill } from "@/ui";
import type { AgenticRunSnapshot, AgenticTask } from "@shared/agent/agentic-run";
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

function RunInlineBody({ snapshot }: { snapshot: AgenticRunSnapshot }) {
  const { run, tasks, agents, events } = snapshot;
  const done = tasks.filter((task) => task.status === "SUCCEEDED").length;
  const agent = agents.find((entry) => entry.status === "WORKING") ?? agents[0];
  const latest = events[events.length - 1];

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
            href="/runs"
            className="text-[length:var(--fs-xs)] text-(--ui-muted) underline-offset-2 hover:underline"
          >
            Open run
          </Link>
        </div>

        <ul className="mt-1.5 space-y-0.5">
          {tasks.map((task) => (
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

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
          {latest ? (
            <span className="min-w-0 truncate">
              {eventLabel(latest.type)}: {latest.summary}
            </span>
          ) : null}
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
