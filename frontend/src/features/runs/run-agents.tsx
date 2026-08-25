"use client";

import { Card, ListRow, RowFacts, StatusPill } from "@/ui";
import type { AgenticRunSnapshot } from "@shared/agent/agentic-run";
import { agentTone, formatTokens, humanStatus } from "./run-formatters";

//
// A logical agent is not a physical model. Five agents may be the one resident
// checkpoint through five independent sessions, so each row names the physical
// model and the behaviour profile rather than implying a second card.
//
export function RunAgents({ snapshot }: { snapshot: AgenticRunSnapshot }) {
  const titleById = new Map(snapshot.tasks.map((task) => [task.id, task.title] as const));

  if (snapshot.agents.length === 0) {
    return <Card className="p-4 text-(--ui-muted)">This run has no agents yet.</Card>;
  }

  return (
    <Card className="divide-y divide-(--ui-separator)/60">
      {snapshot.agents.map((agent) => (
        <ListRow
          key={agent.id}
          label={agent.name}
          status={
            <StatusPill tone={agentTone(agent.status)} variant="badge">
              {humanStatus(agent.status)}
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
                value: agent.modelDisplayName ?? agent.physicalModelId,
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
      ))}
    </Card>
  );
}
