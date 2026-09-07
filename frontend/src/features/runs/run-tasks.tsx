"use client";

import { criterionIsSatisfied } from "@shared/agent/acceptance";
import { Card, ListRow, RowDetailLine, StatusPill } from "@/ui";
import type { AgenticRunSnapshot, AgenticTask } from "@shared/agent/agentic-run";
import { humanStatus, taskTone } from "./run-formatters";

export function RunTasks({ snapshot }: { snapshot: AgenticRunSnapshot }) {
  const titleById = new Map(snapshot.tasks.map((task) => [task.id, task.title] as const));

  if (snapshot.tasks.length === 0) {
    return <Card className="p-4 text-(--ui-muted)">This run has no tasks yet.</Card>;
  }

  return (
    <Card className="divide-y divide-(--ui-separator)/60">
      {snapshot.tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          titleById={titleById}
          activeTaskId={snapshot.run.activeTaskId}
        />
      ))}
    </Card>
  );
}

function TaskRow({
  task,
  titleById,
  activeTaskId,
}: {
  task: AgenticTask;
  titleById: ReadonlyMap<string, string>;
  activeTaskId: string | null;
}) {
  const outstanding = task.acceptance.filter((criterion) => !criterionIsSatisfied(criterion));
  const dependencies = task.dependencies.map((id) => titleById.get(id) ?? id).filter(Boolean);
  const active = task.id === activeTaskId;

  return (
    <ListRow
      className={active ? "bg-(--ui-info)/8 ring-1 ring-inset ring-(--ui-info)/30" : undefined}
      label={task.title}
      status={
        <StatusPill tone={taskTone(task.status)} variant="badge">
          {humanStatus(task.status)}
        </StatusPill>
      }
      value={
        active ? (
          <span className="text-[length:var(--fs-xs)] font-medium text-(--ui-info)">current</span>
        ) : null
      }
    >
      <RowDetailLine>{task.description}</RowDetailLine>
      {dependencies.length > 0 ? (
        <RowDetailLine>Depends on: {dependencies.join(", ")}</RowDetailLine>
      ) : null}
      <RowDetailLine>
        Acceptance {task.acceptance.length - outstanding.length} / {task.acceptance.length}
        {task.attemptCount > 0 ? ` · attempt ${task.attemptCount}` : ""}
      </RowDetailLine>
      {task.acceptance.map((criterion) => (
        <RowDetailLine key={criterion.id}>
          {criterionIsSatisfied(criterion) ? "✓" : "○"} {criterion.description}
          {criterion.evidence ? ` — ${criterion.evidence}` : ""}
          {criterion.evidence || criterion.satisfied
            ? criterion.evidenceSource === "runtime_observation"
              ? " · Runtime observed"
              : criterion.evidenceSource === "model_report"
                ? " · Model reported · Not independently verified"
                : " · Legacy evidence · Not independently verified"
            : ""}
        </RowDetailLine>
      ))}
      {task.blocker ? <RowDetailLine tone="danger">{task.blocker}</RowDetailLine> : null}
    </ListRow>
  );
}
