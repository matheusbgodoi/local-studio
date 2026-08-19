"use client";

import { ActivityHeatmap, type ActivityCell } from "@/features/usage/activity-heatmap";
import { EnergySettings } from "@/features/usage/energy-settings";
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
  decimals,
  duration,
  exactNumber,
  kilowattHours,
  money,
  percent,
  UNAVAILABLE,
  watts,
} from "@/features/usage/usage-formatters";
import type { UsageEnergy, UsageFilters } from "@/lib/types";

const UNATTRIBUTED = "unattributed";

export const costOf = (kwh: number | null, rate: number | null): number | null =>
  kwh === null || rate === null ? null : kwh * rate;

export function UsageEnergyTab({
  energy,
  filters,
  preferences,
  onPreferences,
  collectionStartedAt,
}: {
  energy: UsageEnergy;
  filters: UsageFilters | undefined;
  preferences: EnergyPreferences;
  onPreferences: (next: EnergyPreferences) => void;
  collectionStartedAt: string | null;
}) {
  const totals = energy.totals;
  const rate = preferences.pricePerKwh;
  const cost = costOf(totals.energy_kwh, rate);

  const cells: ActivityCell[] = energy.daily.map((day) => ({
    date: day.date,
    value: day.energy_kwh,
    summary: [
      kilowattHours(day.energy_kwh),
      rate === null ? "rate not set" : money(costOf(day.energy_kwh, rate), preferences.currency, 2),
      `${watts(day.avg_power_w)} avg`,
      `${watts(day.peak_power_w)} peak`,
      `coverage ${percent(day.coverage_pct)}${day.status === "partial" ? " (partial)" : ""}`,
    ].join(" · "),
  }));

  return (
    <>
      <HeroMetric
        value={kilowattHours(totals.energy_kwh)}
        label="GPU energy"
        caption="Board power drawn by the RTX 3090, integrated over measured time. CPU, RAM, fans and power-supply losses are not included."
      />

      <MetricStrip
        metrics={[
          {
            label: "Estimated GPU cost",
            value: rate === null ? "Set rate" : money(cost, preferences.currency),
            hint:
              rate === null
                ? "Enter your electricity rate below to price this period"
                : "Historical estimates use your currently configured electricity rate",
          },
          { label: "Average power", value: watts(totals.avg_power_w) },
          { label: "Peak power", value: watts(totals.peak_power_w) },
          { label: "Measured time", value: duration(totals.measured_seconds) },
          {
            label: "Coverage",
            value: percent(totals.coverage_pct),
            hint: `${duration(totals.measured_seconds)} measured of ${duration(totals.expected_seconds)} elapsed`,
          },
          { label: "Samples", value: exactNumber(totals.samples) },
        ]}
      />

      {energy.available ? null : (
        <EmptyNote>
          {collectionStartedAt
            ? "No GPU power samples in this period. The days before the sampler started are blank rather than zero."
            : "GPU energy accounting has not started on this rig yet. Nothing is estimated in its place."}
        </EmptyNote>
      )}

      <PanelGrid>
        <EnergySettings preferences={preferences} onChange={onPreferences} />

        <PanelCard title="Thermals" description="Averaged over measured time.">
          <MetricRows
            metrics={[
              { label: "Average temperature", value: decimals(totals.avg_temp_c, 1, " °C") },
              { label: "Peak temperature", value: decimals(totals.peak_temp_c, 0, " °C") },
              { label: "Average utilisation", value: percent(totals.avg_utilization_pct, 1) },
            ]}
          />
        </PanelCard>

        <PanelCard title="Coverage" description="Unmeasured seconds are unknown, never zero watts.">
          <MetricRows
            metrics={[
              { label: "Measured", value: duration(totals.measured_seconds) },
              { label: "Elapsed", value: duration(totals.expected_seconds) },
              { label: "Status", value: totals.status },
              {
                label: "Sample interval",
                value:
                  filters?.energy_sample_interval_s === null ||
                  filters?.energy_sample_interval_s === undefined
                    ? UNAVAILABLE
                    : `${filters.energy_sample_interval_s} s`,
              },
            ]}
          />
        </PanelCard>
      </PanelGrid>

      <PanelBlock title="Daily GPU energy">
        {cells.length === 0 ? (
          <EmptyNote>No measured days yet.</EmptyNote>
        ) : (
          <ActivityHeatmap
            cells={cells}
            metricLabel="GPU energy"
            timezone={preferences.timezone}
            rangeStart={filters?.range.first_day ?? null}
            rangeEnd={filters?.range.last_day ?? null}
          />
        )}
      </PanelBlock>

      <PanelBlock title="By model">
        <BreakdownTable
          columns={["Model", "Energy", "Estimated cost", "Measured", "Avg power", "Peak power"]}
          emptyLabel="No measured energy in this period."
          rows={energy.by_model.map((model) => ({
            key: model.model ?? UNATTRIBUTED,
            cells: [
              model.model ?? UNATTRIBUTED,
              kilowattHours(model.energy_kwh),
              rate === null
                ? UNAVAILABLE
                : money(costOf(model.energy_kwh, rate), preferences.currency),
              duration(model.measured_seconds),
              watts(model.avg_power_w),
              watts(model.peak_power_w),
            ],
          }))}
        />
      </PanelBlock>
    </>
  );
}
