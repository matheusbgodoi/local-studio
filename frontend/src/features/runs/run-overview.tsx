"use client";

import { Card, ProgressBar, Stat, StatusPill } from "@/ui";
import type { AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { isProtectedPolicy } from "@shared/agent/network-policy";
import { RunNetworkStat } from "./run-network-badge";
import { formatElapsed, formatTokens, humanStatus, runTone } from "./run-formatters";

//
// Three quantities, never collapsed into one: the ACTIVE context, which a
// compaction is supposed to lower; the lifetime spend, which never moves down;
// and how many times memory was rewritten.
//
export function RunOverview({
  snapshot,
  asOfMs,
}: {
  snapshot: AgenticRunSnapshot;
  asOfMs: number;
}) {
  const { run, tasks, agents } = snapshot;
  const done = tasks.filter((task) => task.status === "SUCCEEDED").length;
  const agent = agents[0];
  const activeContext = agent?.activeContextTokens ?? 0;
  const contextLimit = agent?.contextLimit || run.usableLimit;
  const cumulative = run.cumulativeInputTokens + run.cumulativeOutputTokens;

  return (
    <Card className="p-4">
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

      <div className="mt-4 flex flex-wrap">
        <Stat label="Elapsed" value={formatElapsed(run.createdAtMs, asOfMs)} />
        <Stat
          label="Context"
          value={`${formatTokens(activeContext)} / ${formatTokens(contextLimit)}`}
        />
        <Stat label="Session" value={`${formatTokens(cumulative)} cumulative`} />
        <Stat label="Compactions" value={String(run.compactionCount)} />
        <Stat
          label="Model"
          value={
            run.behaviorProfile
              ? `${run.physicalModelId} · ${run.behaviorProfile}`
              : run.physicalModelId
          }
        />
        <Stat label="Window" value={formatTokens(run.contextWindow)} />
        {isProtectedPolicy(run.networkPolicy) ? <RunNetworkStat /> : null}
      </div>

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
