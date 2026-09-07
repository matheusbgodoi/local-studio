"use client";

import { Card, ListRow, RowFacts, StatusPill } from "@/ui";
import type { AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { agentTone, formatTokens, humanStatus } from "./run-formatters";

//
// A logical agent is not a physical model. Five agents may be the one resident
// checkpoint through five independent sessions, so each row names the physical
// model and the behaviour profile rather than implying a second card.
//
export function RunAgents({
  snapshot,
  displayName,
}: {
  snapshot: AgenticRunSnapshot;
  displayName: (
    modelDisplayName: string | null,
    physicalModelId: string,
    modelId: string,
  ) => string;
}) {
  const titleById = new Map(snapshot.tasks.map((task) => [task.id, task.title] as const));
  const inferenceByAgent = new Map(
    snapshot.inferenceActivity.map((activity) => [activity.agentId, activity] as const),
  );

  if (snapshot.agents.length === 0) {
    return <Card className="p-4 text-(--ui-muted)">This run has no agents yet.</Card>;
  }

  return (
    <Card className="divide-y divide-(--ui-separator)/60">
      {snapshot.agents.map((agent) => {
        const inference = inferenceByAgent.get(agent.id);
        const inferenceLabel =
          inference?.phase === "GENERATING"
            ? "Generating"
            : inference?.phase === "QUEUED_FOR_INFERENCE"
              ? "Waiting for model"
              : null;
        const statusLabel =
          agent.status === "COMPACTING" && inferenceLabel
            ? `Compacting · ${inferenceLabel.toLowerCase()}`
            : (inferenceLabel ?? humanStatus(agent.status));
        return (
          <ListRow
            key={agent.id}
            label={agent.name}
            status={
              <StatusPill tone={agentTone(agent.status)} variant="badge">
                {statusLabel}
              </StatusPill>
            }
          >
            <RowFacts
              items={[
                {
                  label: "Task",
                  value: agent.currentTaskId ? (titleById.get(agent.currentTaskId) ?? "—") : "—",
                },
                { label: "Role", value: agent.role },
                {
                  label: "Model",
                  value: displayName(agent.modelDisplayName, agent.physicalModelId, agent.modelId),
                },
                {
                  label: "Context",
                  value: `${formatTokens(agent.activeContextTokens)} / ${formatTokens(agent.contextLimit)}`,
                  mono: true,
                },
                {
                  label: "Session",
                  value: `${formatTokens(agent.cumulativeInputTokens + agent.cumulativeOutputTokens)} cumulative`,
                  mono: true,
                },
                { label: "Compactions", value: String(agent.compactionCount), mono: true },
              ]}
            />
          </ListRow>
        );
      })}
    </Card>
  );
}
