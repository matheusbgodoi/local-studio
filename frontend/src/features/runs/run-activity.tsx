"use client";

import { Card, RowDetailLine, StatusDot } from "@/ui";
import type { AgenticEvent, AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { eventLabel, formatClock, formatTokens } from "./run-formatters";

const TONE_BY_TYPE: Record<string, "good" | "warning" | "danger" | "info" | "default"> = {
  RUN_COMPLETED: "good",
  TASK_SUCCEEDED: "good",
  ACCEPTANCE_SATISFIED: "good",
  RUN_FAILED: "danger",
  ACCEPTANCE_REJECTED: "warning",
  TASK_WAITING_USER: "warning",
  RUN_RECOVERED: "warning",
  REPLAN: "warning",
  PLAN_REVISED: "warning",
  COMPACTED: "info",
  AGENT_RESUMED: "info",
};

const MAX_EVENTS = 200;

export function RunActivity({ snapshot }: { snapshot: AgenticRunSnapshot }) {
  const events = [...snapshot.events].slice(-MAX_EVENTS).reverse();
  if (events.length === 0) {
    return <Card className="p-4 text-(--ui-muted)">Nothing has happened on this run yet.</Card>;
  }
  return (
    <Card className="divide-y divide-(--ui-separator)/60">
      {events.map((event) => (
        <ActivityRow key={event.id} event={event} />
      ))}
    </Card>
  );
}

function ActivityRow({ event }: { event: AgenticEvent }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <span className="mt-2 shrink-0">
        <StatusDot tone={TONE_BY_TYPE[event.type] ?? "default"} />
      </span>
      <span className="mt-0.5 shrink-0 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
        {formatClock(event.createdAtMs)}
      </span>
      <div className="min-w-0">
        <div className="text-[length:var(--fs-md)] text-(--ui-fg)">{eventLabel(event.type)}</div>
        <RowDetailLine>{event.summary}</RowDetailLine>
        {compactionDetail(event)}
      </div>
    </div>
  );
}

function compactionDetail(event: AgenticEvent) {
  if (event.type !== "COMPACTED") return null;
  const detail = event.detail;
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;
  const before = Number(record.tokensBefore);
  const limit = Number(record.usableLimit);
  const measured = record.afterMeasured !== false;
  const afterValue = measured ? record.tokensAfter : record.tokensAfterEstimated;
  const after = typeof afterValue === "number" && Number.isFinite(afterValue) ? afterValue : null;
  if (!Number.isFinite(before)) return null;
  return (
    <RowDetailLine mono>
      {record.beforeMeasured === false ? "≈" : ""}
      {formatTokens(before)} →{" "}
      {after === null ? "unknown" : `${measured ? "" : "≈"}${formatTokens(after)}`} of{" "}
      {formatTokens(limit)} usable · the task resumed automatically
    </RowDetailLine>
  );
}
