"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import { StatusPill } from "@/ui";
import type { AgenticRunSnapshot, AgenticTask } from "@shared/agent/agentic-run";
import { isProtectedPolicy } from "@shared/agent/network-policy";
import { ComposerColumn } from "./composer-column";
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

//
// Whether the strip is open, remembered across reloads.
//
// It sits above the composer and takes its height from the conversation, so an
// owner who wants it small should not have to close it again every time. Closed
// is the default: the summary line carries status, goal, progress and the
// things that were worth glancing at anyway.
//
const OPEN_KEY = "local-studio.runs.inlinePanelOpen";

function readOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(OPEN_KEY, value ? "1" : "0");
  } catch {
    // a browser that refuses storage still gets a working toggle for this session
  }
}

function RunContext({ context, limit }: { context: string; limit: string }) {
  return (
    <span>
      Context <span className="font-mono">{`${context} / ${limit}`}</span>
    </span>
  );
}

//
// What the strip says when it is closed. Everything the open view carries that
// is worth a glance — what it is doing now, how much context it holds, how many
// times it has rewritten memory — on one line, so closing it loses the detail
// and not the picture.
//
function RunInlineSummary({
  activeTitle,
  context,
  limit,
  compactions,
}: {
  activeTitle: string | null;
  context: string;
  limit: string;
  compactions: number;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pl-7 text-[length:var(--fs-xs)] text-(--ui-muted)">
      {activeTitle ? <span className="min-w-0 truncate">{activeTitle}</span> : null}
      <RunContext context={context} limit={limit} />
      <span>
        {compactions} compaction{compactions === 1 ? "" : "s"}
      </span>
    </p>
  );
}

//
// The open view: the windowed task list, whatever happened last, and the three
// quantities the durable runtime keeps separate — active context, lifetime
// spend and how many compactions there have been.
//
function RunInlineDetails({
  tasks,
  agents,
  hiddenCount,
  expanded,
  onToggleTasks,
  latest,
  protectedRun,
  context,
  limit,
  compactions,
}: {
  tasks: readonly AgenticTask[];
  agents: AgenticRunSnapshot["agents"];
  hiddenCount: number;
  expanded: boolean;
  onToggleTasks: () => void;
  latest: AgenticRunSnapshot["events"][number] | undefined;
  protectedRun: boolean;
  context: string;
  limit: string;
  compactions: number;
}) {
  return (
    <>
      <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto overscroll-contain">
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
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onToggleTasks}
          className="mt-1 text-[length:var(--fs-xs)] text-(--ui-muted) underline-offset-2 hover:text-(--ui-fg) hover:underline"
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more task${hiddenCount === 1 ? "" : "s"}`}
        </button>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
        {latest ? (
          <span className="min-w-0 truncate">
            {eventLabel(latest.type)}: {latest.summary}
          </span>
        ) : null}
        {protectedRun ? <RunNetworkBadge /> : null}
        <div className="grow" />
        <RunContext context={context} limit={limit} />
        <span>
          {compactions} compaction{compactions === 1 ? "" : "s"}
        </span>
      </div>
    </>
  );
}

function deriveRunInlineView(snapshot: AgenticRunSnapshot, expanded: boolean) {
  const { run, tasks, agents, events } = snapshot;
  const active = tasks.find((task) => task.id === run.activeTaskId) ?? null;
  const activeAgent = active?.agentId
    ? agents.find((entry) => entry.id === active.agentId)
    : undefined;
  const agent =
    activeAgent ??
    agents.find((entry) => entry.status === "COMPACTING") ??
    agents.find((entry) => entry.status === "WORKING") ??
    agents[0];
  const activeIndex = Math.max(
    0,
    tasks.findIndex((task) => task.id === run.activeTaskId),
  );
  const window = Math.max(0, Math.min(activeIndex - 1, tasks.length - COLLAPSED_TASKS));
  return {
    run,
    tasks,
    agents,
    active,
    agent,
    latest: events.at(-1),
    done: tasks.filter((task) => task.status === "SUCCEEDED").length,
    visibleTasks: expanded ? tasks : tasks.slice(window, window + COLLAPSED_TASKS),
    hiddenCount: Math.max(0, tasks.length - COLLAPSED_TASKS),
  };
}

function RunInlineBody({ snapshot }: { snapshot: AgenticRunSnapshot }) {
  const [open, setOpen] = useState(readOpen);
  const [expanded, setExpanded] = useState(false);
  const { run, tasks, agents, active, agent, latest, done, visibleTasks, hiddenCount } =
    deriveRunInlineView(snapshot, expanded);

  const toggle = (): void => {
    setOpen((value) => {
      writeOpen(!value);
      return !value;
    });
  };

  return (
    <ComposerColumn className="pb-1">
      <div className="rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? "Collapse run details" : "Expand run details"}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)"
          >
            <ChevronRight className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <StatusPill tone={runTone(run.status)} variant="badge">
            {humanStatus(run.status)}
          </StatusPill>
          <button
            type="button"
            onClick={toggle}
            className="min-w-0 flex-1 truncate text-left text-[length:var(--fs-md)] text-(--ui-fg)"
            title={run.goal}
          >
            {run.goal}
          </button>
          <span className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted)">
            {done} / {tasks.length}
          </span>
          {!open && isProtectedPolicy(run.networkPolicy) ? <RunNetworkBadge /> : null}
          <Link
            href={`/runs?run=${encodeURIComponent(run.id)}`}
            className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted) underline-offset-2 hover:underline"
          >
            Open run
          </Link>
        </div>

        {open ? null : (
          <RunInlineSummary
            activeTitle={active?.title ?? null}
            context={formatTokens(agent?.activeContextTokens ?? 0)}
            limit={formatTokens(agent?.contextLimit || run.usableLimit)}
            compactions={run.compactionCount}
          />
        )}

        {open ? (
          <RunInlineDetails
            tasks={visibleTasks}
            agents={agents}
            hiddenCount={hiddenCount}
            expanded={expanded}
            onToggleTasks={() => setExpanded((value) => !value)}
            latest={latest}
            protectedRun={isProtectedPolicy(run.networkPolicy)}
            context={formatTokens(agent?.activeContextTokens ?? 0)}
            limit={formatTokens(agent?.contextLimit || run.usableLimit)}
            compactions={run.compactionCount}
          />
        ) : null}
      </div>
    </ComposerColumn>
  );
}
