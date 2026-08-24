"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Spinner } from "@/ui";
import { ExternalLink } from "@/ui/icon-registry";
import { isProtectedPolicy } from "@shared/agent/network-policy";
import { RunDetail } from "./run-detail";
import { RunNetworkBadge } from "./run-network-badge";
import { useSessionRunState } from "./use-session-run";

//
// The conversation's own Run, in the right-hand panel beside it. It is the same
// deep view the /runs page renders — the owner should not have to learn a second
// vocabulary for the same Run, nor leave the chat to read it — so everything
// below the header comes from RunDetail, and this file only answers which Run
// belongs here and what to say when none does.
//
// Three states, none of them invented: the list has not answered yet, this
// conversation drives no Run at all, or it drives one whose snapshot is on its
// way. Only the middle one is a statement of fact, so only it gets words.
//

export function RunSessionPanel({
  sessionId,
  piSessionId,
}: {
  sessionId: string | null | undefined;
  piSessionId: string | null | undefined;
}) {
  const { run, snapshot, loading } = useSessionRunState(sessionId, piSessionId);

  if (!run) {
    return (
      <PanelShell>
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <p className="py-6 text-center text-[length:var(--fs-sm)] text-(--dim)">
            No durable Run for this conversation
          </p>
        )}
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <div className="mb-3 flex items-center gap-3 text-[length:var(--fs-xs)] text-(--dim)">
        {isProtectedPolicy(run.networkPolicy) ? <RunNetworkBadge /> : null}
        <div className="grow" />
        <Link
          href={`/runs?run=${encodeURIComponent(run.id)}`}
          className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:text-(--fg) hover:underline"
        >
          Open full Run
          <ExternalLink className="h-3 w-3 shrink-0" />
        </Link>
      </div>
      {snapshot ? (
        <RunDetail snapshot={snapshot} />
      ) : (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
    </PanelShell>
  );
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-(--color-panel) px-3 py-3">
      {children}
    </section>
  );
}
