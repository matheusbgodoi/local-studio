"use client";

import { Card, ProgressBar, Stat, StatusPill } from "@/ui";
import type { AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { isProtectedPolicy } from "@shared/agent/network-policy";
import { RunNetworkStat } from "./run-network-badge";
import { representativeAgent, runTokenTotals } from "./run-context";
import { formatElapsed, formatTokens, humanStatus, runTone } from "./run-formatters";

//
// Three quantities, never collapsed into one: the ACTIVE context, which a
// compaction is supposed to lower; the lifetime spend, which never moves down;
// and how many times memory was rewritten.
//
//
// The value type is sized for the wide row. In the narrow grid a column is
// about a hundred pixels, and the same type turns "83.1K / 128.0K" into three
// stacked lines, so it steps down until there is room for it again.
//
const STAT = [
  "border-r-0 px-0",
  "[&>dd]:text-[length:var(--fs-base)] [&>dd]:leading-snug",
  "@2xl:border-r @2xl:pr-4 @2xl:pl-5 @2xl:first:pl-0 @2xl:last:border-r-0",
  "@2xl:[&>dd]:text-[length:var(--fs-xl)] @2xl:[&>dd]:leading-none",
].join(" ");

export function RunOverview({
  snapshot,
  asOfMs,
  modelDisplayName,
}: {
  snapshot: AgenticRunSnapshot;
  asOfMs: number;
  modelDisplayName: string;
}) {
  const { run, tasks, agents } = snapshot;
  const done = tasks.filter((task) => task.status === "SUCCEEDED").length;
  //
  // The reading belongs to whichever agent is carrying the run, not to
  // agents[0]. A run with three logical agents whose first one has already
  // settled reported a context of zero while another agent was still holding
  // 130K, which read as a broken gauge rather than as a finished agent.
  //
  const agent = representativeAgent(snapshot);
  const activeContext = agent?.activeContextTokens ?? 0;
  const contextLimit = agent?.contextLimit || run.usableLimit;
  const tokens = runTokenTotals(run);

  return (
    <Card className="@container p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={runTone(run.status)} variant="badge">
          {humanStatus(run.status)}
        </StatusPill>
        <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">
          {done} / {tasks.length} tasks · plan revision {run.planRevision} · {agents.length} logical
          agent{agents.length === 1 ? "" : "s"} · 1 inference slot
        </span>
      </div>

      <p className="mt-2 text-[length:var(--fs-lg)] text-(--ui-fg)">{run.goal}</p>

      <div className="mt-3">
        <ProgressBar progress={tasks.length === 0 ? 0 : (done / tasks.length) * 100} />
      </div>

      {/*
        Two columns when the card is narrow — a side panel — and the original
        divided row once it has the width for it. The dividers only make sense
        in the row, so they are dropped in the grid.
      */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 @2xl:flex @2xl:flex-wrap @2xl:gap-0">
        <Stat className={STAT} label="Elapsed" value={formatElapsed(run.createdAtMs, asOfMs)} />
        <Stat
          className={STAT}
          label="Context"
          value={`${formatTokens(activeContext)} / ${formatTokens(contextLimit)}`}
        />
        <Stat className={STAT} label="Tokens" value={formatTokens(tokens.total)} />
        <Stat className={STAT} label="Compactions" value={String(run.compactionCount)} />
        <Stat className={STAT} label="Model" value={modelDisplayName} />
        <Stat className={STAT} label="Window" value={formatTokens(run.contextWindow)} />
        {isProtectedPolicy(run.networkPolicy) ? <RunNetworkStat /> : null}
      </div>

      <p className="mt-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
        {formatTokens(tokens.input)} in · {formatTokens(tokens.output)} out ·{" "}
        {formatTokens(tokens.cached)} cached
        {agent ? ` · context from ${agent.name}` : ""}
      </p>

      {run.recoveryState ? (
        <p className="mt-3 text-[length:var(--fs-xs)] text-(--ui-warning)">
          Recovered after a restart: {run.recoveryState}
        </p>
      ) : null}
      {run.failureReason ? (
        <p className="mt-3 text-[length:var(--fs-xs)] text-(--ui-danger)">{run.failureReason}</p>
      ) : null}
      {run.resultSummary ? (
        <p className="mt-3 text-[length:var(--fs-xs)] text-(--ui-muted)">{run.resultSummary}</p>
      ) : null}
    </Card>
  );
}
