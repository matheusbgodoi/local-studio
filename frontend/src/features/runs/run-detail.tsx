"use client";

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/ui";
import type { AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { RunActivity } from "./run-activity";
import { RunAgents } from "./run-agents";
import { RunOverview } from "./run-overview";
import { RunTasks } from "./run-tasks";

//
// The deep view of one Run, owned by neither surface that shows it: the /runs
// page and the conversation's Run tab render the same overview, the same three
// sections and the same strip. Only what sits beside the strip differs — the
// page can resume and cancel, the sidebar links out — so that arrives as a slot
// rather than being decided here.
//

type RunSection = "tasks" | "agents" | "activity";

const SECTIONS = [
  { id: "tasks", label: "Tasks" },
  { id: "agents", label: "Agents" },
  { id: "activity", label: "Activity" },
] satisfies Array<{ id: RunSection; label: string }>;

export function RunDetail({
  snapshot,
  actions,
}: {
  snapshot: AgenticRunSnapshot;
  actions?: ReactNode;
}) {
  const [section, setSection] = useState<RunSection>("tasks");
  return (
    <div className="min-w-0 space-y-4">
      <RunOverview snapshot={snapshot} asOfMs={snapshot.run.updatedAtMs} />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl items={SECTIONS} value={section} onChange={setSection} size="sm" />
        <div className="grow" />
        {actions}
      </div>
      {section === "tasks" ? <RunTasks snapshot={snapshot} /> : null}
      {section === "agents" ? <RunAgents snapshot={snapshot} /> : null}
      {section === "activity" ? <RunActivity snapshot={snapshot} /> : null}
    </div>
  );
}
