"use client";

import { ActivityHeatmap, type ActivityCell } from "@/features/usage/activity-heatmap";
import type { EnergyPreferences } from "@/features/usage/energy-preferences";
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
  decimals,
  perKwh,
  kilowattHours,
  money,
  percent,
  tokensPerSecond,
  UNAVAILABLE,
} from "@/features/usage/usage-formatters";
import type { UsageEfficiency, UsageFilters, UsageTokens } from "@/lib/types";

const costPerMillion = (kwhPerMillion: number | null, rate: number | null): number | null =>
  kwhPerMillion === null || rate === null ? null : kwhPerMillion * rate;

export function UsageEfficiencyTab({
  efficiency,
  tokens,
  filters,
  preferences,
}: {
  efficiency: UsageEfficiency;
  tokens: UsageTokens;
  filters: UsageFilters | undefined;
  preferences: EnergyPreferences;
}) {
  const totals = efficiency.totals;
  const rate = preferences.pricePerKwh;

  const cells: ActivityCell[] = efficiency.daily.map((day) => ({
    date: day.date,
    value: day.tokens_per_kwh,
    summary: [
      `${perKwh(day.tokens_per_kwh)} tokens/kWh`,
      `${decimals(day.kwh_per_million_processed, 3)} kWh per 1M`,
      rate === null
        ? "rate not set"
        : `${money(costPerMillion(day.kwh_per_million_processed, rate), preferences.currency)} per 1M`,
      `${compactTokens(day.processed_tokens)} processed`,
      kilowattHours(day.energy_kwh),
      `coverage ${percent(day.coverage_pct)}`,
    ].join(" · "),
  }));

  if (totals.tokens_per_kwh === null) {
    return (
      <>
        <HeroMetric value={UNAVAILABLE} label="Processed tokens / kWh" />
        <EmptyNote>
          Efficiency needs both measured GPU energy and processed tokens in this period. One of them
          is missing, so no ratio is shown rather than a misleading one.
        </EmptyNote>
      </>
    );
  }

  return (
    <>
      <HeroMetric
        value={perKwh(totals.tokens_per_kwh)}
        label="Processed tokens / kWh"
        caption={
          totals.partial
            ? `Partial: only ${percent(totals.coverage_pct)} of this period was measured, so the energy denominator is incomplete.`
            : "Useful model work per unit of GPU board energy."
        }
      />

      <MetricStrip
        metrics={[
          {
            label: "kWh / 1M processed",
            value: decimals(totals.kwh_per_million_processed, 3),
          },
          {
            label: "Cost / 1M processed",
            value:
              rate === null
                ? "Set rate"
                : money(
                    costPerMillion(totals.kwh_per_million_processed, rate),
                    preferences.currency,
                  ),
          },
          { label: "Processed", value: compactTokens(totals.processed_tokens) },
          { label: "GPU energy", value: kilowattHours(totals.energy_kwh) },
          {
            label: "Estimated cost",
            value:
              rate === null || totals.energy_kwh === null
                ? "Set rate"
                : money(totals.energy_kwh * rate, preferences.currency),
          },
          { label: "Coverage", value: percent(totals.coverage_pct) },
        ]}
      />

      <PanelGrid>
        <PanelCard
          title="Throughput"
          description="Engine-measured, for context on the ratio above."
        >
          <MetricRows
            metrics={[
              { label: "Decode", value: tokensPerSecond(tokens.performance.decode_tps) },
              { label: "Prefill", value: tokensPerSecond(tokens.performance.prefill_tps) },
            ]}
          />
        </PanelCard>

        <PanelCard title="Basis">
          <MetricRows
            metrics={[
              { label: "Processed tokens", value: compactTokens(totals.processed_tokens) },
              { label: "Measured energy", value: kilowattHours(totals.energy_kwh) },
              { label: "Denominator", value: totals.partial ? "partial" : "complete" },
            ]}
          />
        </PanelCard>
      </PanelGrid>

      <PanelBlock title="Daily efficiency">
        {cells.length === 0 ? (
          <EmptyNote>No day has both energy and token data yet.</EmptyNote>
        ) : (
          <ActivityHeatmap
            cells={cells}
            metricLabel="processed tokens per kWh"
            timezone={preferences.timezone}
            rangeStart={filters?.range.first_day ?? null}
            rangeEnd={filters?.range.last_day ?? null}
          />
        )}
      </PanelBlock>

      <PanelBlock title="By model">
        <BreakdownTable
          columns={["Model", "Processed", "Energy", "Tokens / kWh", "kWh / 1M", "Cost / 1M"]}
          emptyLabel="No model has both energy and token data in this period."
          rows={efficiency.by_model.map((model) => ({
            key: model.model,
            cells: [
              model.model,
              compactTokens(model.processed_tokens),
              kilowattHours(model.energy_kwh),
              perKwh(model.tokens_per_kwh),
              decimals(model.kwh_per_million_processed, 3),
              rate === null
                ? UNAVAILABLE
                : money(
                    costPerMillion(model.kwh_per_million_processed, rate),
                    preferences.currency,
                  ),
            ],
          }))}
        />
      </PanelBlock>
    </>
  );
}
