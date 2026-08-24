"use client";

import { useSearchParams } from "next/navigation";
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
import { cancelSelectedRun, refreshRuns, selectRun, resumeSelectedRun } from "./runs-store";
import { useRuns } from "./use-runs";

export default function RunsPage() {
  const { runs, snapshot, selectedId, loading, error } = useRuns();
  const requestedId = useSearchParams().get("run");

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

  return (
    <AppPage>
      <PageContainer width="lg">
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

        {loading && runs.length === 0 ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : runs.length === 0 ? (
          <Card className="p-6 text-(--ui-muted)">
            No runs yet. A run is created when a goal is handed to the agent; ordinary chat stays
            ordinary chat and never becomes one.
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Card className="divide-y divide-(--ui-separator)/60">
              {runs.map((run) => (
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
              {snapshot ? (
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
