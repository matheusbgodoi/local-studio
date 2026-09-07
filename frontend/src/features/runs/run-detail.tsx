"use client";

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/ui";
import type { AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { displayNameForModel, useServedModels } from "@/hooks/served-models-store";
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
  const { physicalModels } = useServedModels();
  const displayName = (modelDisplayName: string | null, physicalModelId: string, modelId: string) =>
    modelDisplayName ??
    displayNameForModel(physicalModels, physicalModelId) ??
    displayNameForModel(physicalModels, modelId) ??
    "Model identity unavailable";
  const runModelDisplayName = displayName(
    snapshot.run.modelDisplayName,
    snapshot.run.physicalModelId,
    snapshot.run.modelId,
  );
  return (
    <div className="min-w-0 space-y-4">
      <RunOverview
        snapshot={snapshot}
        asOfMs={snapshot.run.updatedAtMs}
        modelDisplayName={runModelDisplayName}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl items={SECTIONS} value={section} onChange={setSection} size="sm" />
        <div className="grow" />
        {actions}
      </div>
      {section === "tasks" ? <RunTasks snapshot={snapshot} /> : null}
      {section === "agents" ? <RunAgents snapshot={snapshot} displayName={displayName} /> : null}
      {section === "activity" ? <RunActivity snapshot={snapshot} /> : null}
    </div>
  );
}
