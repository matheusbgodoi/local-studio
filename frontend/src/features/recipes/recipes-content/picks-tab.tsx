"use client";

import { useCallback } from "react";
import { RefreshCw } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { cx } from "@/ui/utils";
import type { ModelIndexResult, ModelIndexVariant } from "@/lib/api/studio";
import { useDownloads } from "@/hooks/use-downloads";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
  type ModelStatusTone,
} from "./model-page";
import { TierSection, useHardwareProfile, useModelIndex } from "./picks-shared";

type CatalogSummary = { tone: ModelStatusTone; label: string; provenance: string | null };

function catalogSummary(
  data: ModelIndexResult | null,
  tierCount: number,
  loading: boolean,
  error: string | null,
): CatalogSummary {
  // PROVENANCE OUTLIVES AN ERROR, because the tiers do.
  //
  // `useModelIndex` never clears `data` on a failed refresh — deliberately, so a transient
  // error does not blank a catalogue the reader was already using. But this returned
  // `provenance: null` for any error, so those still-rendered tiers lost the line saying where
  // they came from. The bundled case is exactly when it matters: an error pill above a list
  // silently shipped inside the app, with the sentence that said so now missing.
  //
  // So the source line is computed from whatever is on screen, and the error only changes the
  // tone and adds itself to it.
  const from = (): string | null => {
    if (!data) return null;
    return data.source === "bundled"
      ? `Shipped with the app on ${data.updated} — this backend has no /studio/model-index, so nothing here reflects it`
      : `Catalog updated ${data.updated}`;
  };

  if (error) {
    const source = from();
    return {
      tone: "danger",
      label: "error",
      provenance: source ? `${source}. Last refresh failed: ${error}` : null,
    };
  }
  if (loading) return { tone: "info", label: "loading", provenance: from() };
  if (!data) return { tone: "default", label: "empty", provenance: null };
  if (data.source === "bundled") {
    return { tone: "warning", label: "bundled catalog", provenance: from() };
  }
  return {
    tone: tierCount ? "good" : "default",
    label: tierCount ? `${tierCount} tiers` : "empty",
    provenance: from(),
  };
}

export function PicksTab() {
  const { data, loading, error, refresh } = useModelIndex();
  const hardware = useHardwareProfile();
  const {
    downloadsByModel,
    startingModelIds,
    error: downloadError,
    unsupported: downloadsUnsupported,
    startDownload,
  } = useDownloads();

  const handleDownload = useCallback(
    (variant: ModelIndexVariant) => {
      void startDownload({
        model_id: variant.repo,
        ...(variant.allow_patterns?.length ? { allow_patterns: variant.allow_patterns } : {}),
      }).catch(() => {});
    },
    [startDownload],
  );

  const tiers = data?.tiers ?? [];
  const summary = catalogSummary(data, tiers.length, loading, error);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ModelStatus tone={summary.tone}>{summary.label}</ModelStatus>
          {summary.provenance ? (
            <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">
              {summary.provenance}
            </span>
          ) : null}
          {hardware.poolGb > 0 ? (
            <span className="text-[length:var(--fs-sm)] text-(--ui-muted)" title={hardware.detail}>
              {Math.round(hardware.poolGb)} GB pool · {hardware.label}
            </span>
          ) : null}
        </div>
        <ModelButton onClick={() => void refresh()} disabled={loading} title="Reload the catalog">
          <RefreshCw className={cx("h-3 w-3", loading ? "animate-spin" : "")} />
          Refresh
        </ModelButton>
      </div>

      {downloadError ? (
        <div
          className={cx(
            "text-[length:var(--fs-sm)]",
            downloadsUnsupported ? "text-(--ui-muted)" : "text-(--err)",
          )}
        >
          {downloadsUnsupported
            ? `Downloads are unavailable on this backend — ${downloadError}`
            : downloadError}
        </div>
      ) : null}

      {loading && tiers.length === 0 ? (
        <PicksLoadingGrid />
      ) : error && tiers.length === 0 ? (
        <PicksErrorState error={error} onRetry={() => void refresh()} />
      ) : tiers.length === 0 ? (
        <PicksEmptyState />
      ) : (
        tiers.map((tier) => (
          <TierSection
            key={tier.id}
            tier={tier}
            poolGb={hardware.poolGb}
            downloadsByModel={downloadsByModel}
            startingModelIds={startingModelIds}
            onDownload={handleDownload}
          />
        ))
      )}
    </div>
  );
}

function PicksLoadingGrid() {
  return (
    <section>
      <div className="border-b border-(--ui-border)/75 pb-2">
        <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Curated catalog</h3>
        <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
          Matching the catalog to this machine.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 pt-3 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="min-h-40 animate-pulse rounded-xl border border-(--ui-border) bg-(--ui-surface)/60 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-lg bg-(--ui-hover)" />
              <div className="space-y-2">
                <div className="h-2.5 w-16 rounded bg-(--ui-hover)" />
                <div className="h-4 w-36 rounded bg-(--ui-hover)" />
              </div>
            </div>
            <div className="mt-4 h-3 w-full rounded bg-(--ui-hover)/80" />
            <div className="mt-2 h-3 w-2/3 rounded bg-(--ui-hover)/60" />
          </div>
        ))}
      </div>
    </section>
  );
}

function PicksErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <ModelSection
      title="Curated catalog"
      description="The controller did not return the model catalog."
      actions={
        <ModelButton tone="primary" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
          Try again
        </ModelButton>
      }
    >
      <ModelRow
        label="Catalog unavailable"
        description={error}
        value={<ModelValue dim>Check the controller connection and try again.</ModelValue>}
      />
    </ModelSection>
  );
}

function PicksEmptyState() {
  return (
    <ModelSection title="Curated catalog" description="No recommendations are available yet.">
      <ModelRow
        label="No curated picks"
        description="Refresh the controller catalog, or use Get to search for model weights."
        value={<ModelValue dim>The catalog returned zero hardware tiers.</ModelValue>}
      />
    </ModelSection>
  );
}
