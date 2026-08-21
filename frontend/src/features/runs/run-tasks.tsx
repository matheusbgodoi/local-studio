"use client";

import { Card, ListRow, RowDetailLine, StatusPill } from "@/ui";
import type { AgenticRunSnapshot, AgenticTask } from "@shared/agent/agentic-run";
import { humanStatus, taskTone } from "./run-formatters";

//
// The DAG rendered as a dependency-ordered hierarchy: each task states what it
// is blocked by, what evidence it still owes, and how many attempts it has
// taken. Acceptance is the gate, so it is what the row is about.
//
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
  const outstanding = task.acceptance.filter((criterion) => !criterion.satisfied);
  const dependencies = task.dependencies.map((id) => titleById.get(id) ?? id).filter(Boolean);

  return (
    <ListRow
      label={task.title}
      status={
        <StatusPill tone={taskTone(task.status)} variant="badge">
          {humanStatus(task.status)}
        </StatusPill>
      }
      value={
        task.id === activeTaskId ? (
          <span className="text-[length:var(--fs-xs)] text-(--ui-info)">current</span>
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
          {criterion.satisfied ? "✓" : "○"} {criterion.description}
          {criterion.evidence ? ` — ${criterion.evidence}` : ""}
        </RowDetailLine>
      ))}
      {task.blocker ? <RowDetailLine tone="danger">{task.blocker}</RowDetailLine> : null}
    </ListRow>
  );
}
