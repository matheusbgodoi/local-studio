"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import type { AgenticRun } from "@shared/agent/agentic-run";
import {
  AppPage,
  Button,
  Card,
  ErrorBox,
  PageContainer,
  PageHeader,
  RefreshButton,
  Spinner,
  StatusPill,
} from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { humanStatus, runTone } from "./run-formatters";
import { RunDetail } from "./run-detail";
import { useRunSnapshotState } from "./use-session-run";
import {
  archiveSelectedRun,
  cancelSelectedRun,
  deleteSelectedRun,
  refreshRuns,
  selectRun,
  resumeSelectedRun,
} from "./runs-store";
import { useRuns } from "./use-runs";

type RunView = "current" | "history" | "archived";

const terminal: ReadonlySet<AgenticRun["status"]> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function viewForRun(run: Pick<AgenticRun, "archivedAtMs" | "status">): RunView {
  if (run.archivedAtMs !== null) return "archived";
  return terminal.has(run.status) ? "history" : "current";
}

export default function RunsPage() {
  const { runs, selectedId, loading, error } = useRuns();
  const selectedSnapshot = useRunSnapshotState(selectedId);
  const snapshot = selectedSnapshot.snapshot;
  const requestedId = useSearchParams().get("run");
  const [view, setView] = useState<RunView>("current");
  const appliedRequestedId = useRef<string | null>(null);
  const visibleRuns = runs.filter((run) => viewForRun(run) === view);

  useMountSubscription(() => {
    if (!requestedId) {
      appliedRequestedId.current = null;
      return;
    }
    if (appliedRequestedId.current === requestedId) return;
    const requestedRun = runs.find((run) => run.id === requestedId);
    if (!requestedRun) return;
    appliedRequestedId.current = requestedId;
    setView(viewForRun(requestedRun));
    selectRun(requestedId);
  }, [requestedId, runs]);

  const canResume =
    snapshot !== null &&
    (snapshot.run.status === "PAUSED" || snapshot.run.status === "WAITING_USER");
  const canCancel = snapshot !== null && !terminal.has(snapshot.run.status);
  const selectedVisible = visibleRuns.some((run) => run.id === selectedId);
  const displayedError = error ?? selectedSnapshot.error;

  const selectView = (next: RunView) => {
    appliedRequestedId.current = requestedId;
    setView(next);
    const first = runs.find((run) => viewForRun(run) === next);
    selectRun(first?.id ?? null);
  };

  return (
    <AppPage>
      <PageContainer width="sm">
        <PageHeader
          eyebrow="Agentic"
          title="Runs"
          description="Durable goals: tasks, logical agents and everything the runtime did without being asked."
          actions={
            <RefreshButton
              onRefresh={() => void refreshRuns()}
              loading={loading}
              className="h-7 w-7"
            />
          }
        />

        {displayedError ? <ErrorBox>{displayedError}</ErrorBox> : null}

        <div className="flex w-fit gap-1 rounded-lg border border-(--ui-separator) p-1">
          {(["current", "history", "archived"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => selectView(item)}
              className={`rounded-md px-3 py-1.5 text-[length:var(--fs-sm)] capitalize ${
                view === item ? "bg-(--ui-active) text-(--ui-fg)" : "text-(--ui-muted)"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {loading && runs.length === 0 ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : visibleRuns.length === 0 ? (
          <Card className="p-6 text-(--ui-muted)">
            {view === "current"
              ? "No active Runs. Completed work remains available in History."
              : view === "history"
                ? "No completed Runs yet."
                : "No archived Runs."}
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Card className="divide-y divide-(--ui-separator)/60">
              {visibleRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => selectRun(run.id)}
                  className={`block w-full px-3 py-2 text-left ${
                    run.id === selectedId ? "bg-(--ui-active)" : "hover:bg-(--ui-hover)"
                  }`}
                >
                  <div className="truncate text-[length:var(--fs-md)] text-(--ui-fg)">
                    {run.goal}
                  </div>
                  <div className="mt-1">
                    <StatusPill tone={runTone(run.status)}>{humanStatus(run.status)}</StatusPill>
                  </div>
                </button>
              ))}
            </Card>

            <div className="min-w-0 space-y-4">
              {snapshot && selectedVisible ? (
                <RunDetail
                  snapshot={snapshot}
                  actions={
                    <>
                      {canResume ? (
                        <Button
                          variant="secondary"
                          onClick={() => void resumeSelectedRun(snapshot.run.id)}
                        >
                          Resume
                        </Button>
                      ) : null}
                      {canCancel ? (
                        <Button
                          variant="secondary"
                          onClick={() => void cancelSelectedRun(snapshot.run.id)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                      {terminal.has(snapshot.run.status) ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const nextId = nextRunIdAfterRemoval(visibleRuns, snapshot.run.id);
                            void archiveSelectedRun(
                              snapshot.run.id,
                              snapshot.run.archivedAtMs === null,
                            ).then((updated) => {
                              if (updated) selectRun(nextId);
                            });
                          }}
                        >
                          {snapshot.run.archivedAtMs === null ? "Archive" : "Restore"}
                        </Button>
                      ) : null}
                      {snapshot.run.archivedAtMs !== null ? (
                        <Button
                          variant="danger"
                          onClick={() => {
                            const confirmed = window.confirm(
                              `Delete “${snapshot.run.goal}” and its complete Run history? This cannot be undone.`,
                            );
                            if (confirmed) void deleteSelectedRun(snapshot.run.id);
                          }}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </>
                  }
                />
              ) : selectedVisible && selectedSnapshot.loading ? (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              ) : (
                <Card className="p-6 text-(--ui-muted)">Select a Run to inspect it.</Card>
              )}
            </div>
          </div>
        )}
      </PageContainer>
    </AppPage>
  );
}

function nextRunIdAfterRemoval(runs: readonly { id: string }[], currentId: string): string | null {
  const index = runs.findIndex((run) => run.id === currentId);
  if (index < 0) return runs[0]?.id ?? null;
  return runs[index + 1]?.id ?? runs[index - 1]?.id ?? null;
}
