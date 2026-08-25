"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
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
import {
  archiveSelectedRun,
  cancelSelectedRun,
  deleteSelectedRun,
  refreshRuns,
  selectRun,
  resumeSelectedRun,
} from "./runs-store";
import { useRuns } from "./use-runs";

export default function RunsPage() {
  const { runs, snapshot, selectedId, loading, error } = useRuns();
  const requestedId = useSearchParams().get("run");
  const [view, setView] = useState<"current" | "history" | "archived">("current");
  const terminal = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
  const visibleRuns = runs.filter((run) => {
    if (view === "archived") return run.archivedAtMs !== null;
    if (run.archivedAtMs !== null) return false;
    return view === "history" ? terminal.has(run.status) : !terminal.has(run.status);
  });

  //
  // A Run is addressable: `/runs?run=<id>` is how the conversation's Run tab
  // hands its Run to the deep view, and how a reload keeps that choice. It is
  // applied only when the id itself changes, so clicking another Run in the
  // list is not fought by a query param that outlived the intent.
  //
  useMountSubscription(() => {
    if (requestedId) selectRun(requestedId);
  }, [requestedId]);

  const canResume =
    snapshot !== null &&
    (snapshot.run.status === "PAUSED" || snapshot.run.status === "WAITING_USER");
  const canCancel =
    snapshot !== null && !["COMPLETED", "FAILED", "CANCELLED"].includes(snapshot.run.status);
  const selectedVisible = visibleRuns.some((run) => run.id === selectedId);

  const selectView = (next: "current" | "history" | "archived") => {
    setView(next);
    const first = runs.find((run) => {
      if (next === "archived") return run.archivedAtMs !== null;
      if (run.archivedAtMs !== null) return false;
      return next === "history" ? terminal.has(run.status) : !terminal.has(run.status);
    });
    if (first) selectRun(first.id);
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

        {error ? <ErrorBox>{error}</ErrorBox> : null}

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
                          onClick={() =>
                            void archiveSelectedRun(
                              snapshot.run.id,
                              snapshot.run.archivedAtMs === null,
                            )
                          }
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
              ) : (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              )}
            </div>
          </div>
        )}
      </PageContainer>
    </AppPage>
  );
}
