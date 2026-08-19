"use client";

import { ActivityHeatmap, type ActivityCell } from "@/features/usage/activity-heatmap";
import {
  BreakdownTable,
  EmptyNote,
  HeroMetric,
  MetricRows,
  MetricStrip,
  PanelBlock,
  PanelCard,
  PanelGrid,
} from "@/features/usage/usage-panels";
import {
  compactTokens,
  exactNumber,
  milliseconds,
  percent,
  tokensPerSecond,
  UNAVAILABLE,
} from "@/features/usage/usage-formatters";
import type { UsageFilters, UsageTokens } from "@/lib/types";

const contextShare = (peak: number | null, limit: number | null): string => {
  if (peak === null) return UNAVAILABLE;
  if (limit === null) return compactTokens(peak);
  return `${compactTokens(peak)} / ${compactTokens(limit)}`;
};

export function UsageTokensTab({
  tokens,
  filters,
  timezone,
}: {
  tokens: UsageTokens;
  filters: UsageFilters | undefined;
  timezone: string;
}) {
  const totals = tokens.totals;
  const performance = tokens.performance;
  const context = tokens.context;

  const cells: ActivityCell[] = tokens.daily.map((day) => ({
    date: day.date,
    value: day.processed_tokens,
    summary: [
      `${exactNumber(day.processed_tokens)} processed`,
      `${exactNumber(day.fresh_prompt_tokens)} fresh`,
      `${exactNumber(day.generated_tokens)} generated`,
      `${exactNumber(day.cached_input_tokens)} cached`,
      `${exactNumber(day.logical_tokens)} logical`,
      `${exactNumber(day.requests)} requests`,
    ].join(" · "),
  }));

  return (
    <>
      <HeroMetric
        value={compactTokens(totals.processed_tokens)}
        label="Processed tokens"
        caption="Fresh prompt processing plus generated tokens. Cached prompt reuse excluded."
      />

      <MetricStrip
        metrics={[
          {
            label: "Fresh input",
            value: compactTokens(totals.fresh_prompt_tokens),
            hint: `${exactNumber(totals.fresh_prompt_tokens)} prompt tokens the engine actually evaluated`,
          },
          {
            label: "Generated",
            value: compactTokens(totals.generated_tokens),
            hint: `${exactNumber(totals.generated_tokens)} tokens produced`,
          },
          {
            label: "Cached input",
            value: compactTokens(totals.cached_input_tokens),
            hint: `${exactNumber(totals.cached_input_tokens)} prompt tokens reused from the KV cache`,
          },
          {
            label: "Logical tokens",
            value: compactTokens(totals.logical_tokens),
            hint: `${exactNumber(totals.logical_tokens)} total context traffic, cached reuse included`,
          },
          { label: "Cache hit", value: percent(totals.cache_hit_rate) },
          { label: "Requests", value: exactNumber(totals.requests) },
        ]}
      />

      <PanelGrid>
        <PanelCard
          title="Performance"
          description="Measured by the engine, not by request duration."
        >
          <MetricRows
            metrics={[
              { label: "Decode", value: tokensPerSecond(performance.decode_tps) },
              { label: "Prefill", value: tokensPerSecond(performance.prefill_tps) },
              { label: "Decode P95", value: tokensPerSecond(performance.decode_tps_p95) },
              { label: "Avg TTFT", value: milliseconds(performance.avg_ttft_ms) },
              { label: "P95 TTFT", value: milliseconds(performance.p95_ttft_ms) },
              { label: "P95 latency", value: milliseconds(performance.p95_latency_ms) },
            ]}
          />
        </PanelCard>

        <PanelCard
          title="Context"
          description="How much of the configured window each request occupied."
        >
          <MetricRows
            metrics={[
              { label: "Average", value: compactTokens(context.avg_tokens) },
              { label: "P95", value: compactTokens(context.p95_tokens) },
              { label: "Peak", value: contextShare(context.peak_tokens, context.limit_tokens) },
              { label: "Peak of window", value: percent(context.peak_pct, 1) },
            ]}
          />
        </PanelCard>

        <PanelCard title="Requests">
          <MetricRows
            metrics={[
              { label: "Success rate", value: percent(totals.success_rate, 1) },
              { label: "Failed", value: exactNumber(totals.failed_requests) },
              {
                label: "Processed / request",
                value: compactTokens(totals.processed_per_request),
              },
              { label: "Avg latency", value: milliseconds(performance.avg_latency_ms) },
            ]}
          />
        </PanelCard>
      </PanelGrid>

      <PanelBlock title="Daily processed tokens">
        {cells.length === 0 ? (
          <EmptyNote>No requests recorded yet.</EmptyNote>
        ) : (
          <ActivityHeatmap
            cells={cells}
            metricLabel="processed tokens"
            timezone={timezone}
            rangeStart={filters?.range.first_day ?? null}
            rangeEnd={filters?.range.last_day ?? null}
          />
        )}
      </PanelBlock>

      <PanelBlock title="By model">
        <BreakdownTable
          columns={[
            "Model",
            "Processed",
            "Fresh",
            "Generated",
            "Cached",
            "Logical",
            "Decode",
            "Requests",
          ]}
          emptyLabel="No requests in this period."
          rows={tokens.by_model.map((model) => ({
            key: model.model,
            cells: [
              model.model,
              compactTokens(model.processed_tokens),
              compactTokens(model.fresh_prompt_tokens),
              compactTokens(model.generated_tokens),
              compactTokens(model.cached_input_tokens),
              compactTokens(model.logical_tokens),
              tokensPerSecond(model.decode_tps),
              exactNumber(model.requests),
            ],
          }))}
        />
      </PanelBlock>
    </>
  );
}
