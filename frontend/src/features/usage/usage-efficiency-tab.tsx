"use client";

import { useState } from "react";
import { EfficiencyCards } from "@/features/usage/usage-efficiency-cards";
import { EfficiencyHero, EfficiencyStrip } from "@/features/usage/usage-efficiency-hero";
import { dailyCells, pricedTraffic, product } from "@/features/usage/usage-efficiency-pricing";
import { ActivityHeatmap, type ActivityCell } from "@/features/usage/activity-heatmap";
import type { EnergyPreferences } from "@/features/usage/energy-preferences";
import { EnergySettings } from "@/features/usage/energy-settings";
import {
  BenchProvenance,
  BenchRateCard,
  excludedByRates,
  pickRate,
} from "@/features/usage/usage-efficiency-rates";
import {
  BreakdownTable,
  EmptyNote,
  HeroMetric,
  HeroSplit,
  MetricRows,
  MetricStrip,
  PanelBlock,
  PanelCard,
  PanelGrid,
  type Metric,
} from "@/features/usage/usage-panels";
import {
  compactTokens,
  decimals,
  exactNumber,
  instantLabel,
  kilowattHours,
  money,
  percent,
  perKwh,
  tokensPerSecond,
  UNAVAILABLE,
} from "@/features/usage/usage-formatters";
import { usageModelLabel, usageModelLabels } from "@/features/usage/usage-model-identity";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type {
  UsageEfficiency,
  UsageEnergyRate,
  UsageEnergyRates,
  UsageFilters,
  UsageTokens,
} from "@/lib/types";

type EfficiencyTotals = UsageEfficiency["totals"];

interface PricedTraffic {
  fresh: number;
  generated: number;
  /** Aliases with traffic this period that this rate does not cover. Named, never priced. */
  unpriced: string[];
}

function ByModelBlock({
  efficiency,
  rates,
  preferences,
  filters,
}: {
  efficiency: UsageEfficiency;
  rates: UsageEnergyRates | undefined;
  preferences: EnergyPreferences;
  filters: UsageFilters | undefined;
}) {
  const { currency, pricePerKwh: price } = preferences;
  const measured = rates?.measured ? rates.by_physical_model : [];
  const physicalToRate = new Map<string, UsageEnergyRate>(
    measured.map((rate) => [rate.model, rate] as const),
  );
  // Off the rates themselves, not off the alias map: a measured rate that arrived with an
  // empty alias list dropped the two columns while the hero above kept pricing with it.
  const hasRates = measured.length > 0;
  const excluded = excludedByRates(measured);

  const columns = ["Model", "Processed", "Energy", "Tokens / kWh", "kWh / 1M"];
  if (price !== null || !hasRates) columns.push("Cost / 1M");
  if (hasRates) {
    columns.push(
      price === null ? "Input Wh / 1M" : "Input / 1M",
      price === null ? "Output Wh / 1M" : "Output / 1M",
    );
  }

  const side = (wh: number | undefined): string => {
    if (wh === undefined) return UNAVAILABLE;
    return price === null ? decimals(wh, 1) : money((wh / 1000) * price, currency, 4);
  };

  return (
    <PanelBlock title="By model">
      <BreakdownTable
        columns={columns}
        minWidthClass={hasRates ? "min-w-[46rem]" : "min-w-[34rem]"}
        emptyLabel="No model has both energy and token data in this period."
        rows={efficiency.by_physical_model.map((model) => {
          // No match means no price. A rate is not transferable between models, and the
          // combined figure cannot be divided into one.
          const bench = physicalToRate.get(model.model);
          const cells = [
            usageModelLabel(model.model, filters),
            compactTokens(model.processed_tokens),
            kilowattHours(model.energy_kwh),
            perKwh(model.tokens_per_kwh),
            decimals(model.kwh_per_million_processed, 3),
          ];
          if (price !== null || !hasRates) {
            cells.push(money(product(model.kwh_per_million_processed, price), currency, 4));
          }
          if (hasRates) {
            cells.push(side(bench?.wh_per_1m_input), side(bench?.wh_per_1m_output));
          }
          return { key: model.model, cells };
        })}
      />
      {hasRates ? (
        <p className="mt-3 text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
          Input and output are the bench rate for the physical model this alias runs on, identical
          across its aliases. Blank where no bench run has measured it — a rate is not transferable
          between models, and the combined figure cannot be split into one.
          {excluded.length > 0
            ? ` The rates exclude ${excluded.join(", ")}, so they do not add up to the energy column beside them.`
            : ""}
        </p>
      ) : null}
    </PanelBlock>
  );
}
function ProvenanceLegend({
  measured,
  traffic,
  modelled,
}: {
  measured: boolean;
  traffic: boolean;
  modelled: boolean;
}) {
  if (!measured && !traffic) return null;
  return (
    <p className="mx-auto mt-6 max-w-[55rem] text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
      {measured ? (
        <>
          <span className="font-medium text-(--ui-fg)/70">Measured</span> — one bench run on this
          rig, fixed in time.{" "}
        </>
      ) : null}
      {traffic ? (
        <>
          <span className="font-medium text-(--ui-fg)/70">Your traffic</span> — this period&rsquo;s
          telemetry, which moves with the period selector.{" "}
        </>
      ) : null}
      {modelled ? (
        <>
          <span className="font-medium text-(--ui-fg)/70">Modelled</span> — your token counts priced
          at the measured rate: arithmetic on the two, not a third measurement.
        </>
      ) : null}
    </p>
  );
}

function BenchNotes({
  rates,
  measuredCount,
  filters,
}: {
  rates: UsageEnergyRates | undefined;
  measuredCount: number;
  filters: UsageFilters | undefined;
}) {
  const unmeasured = rates?.unmeasured_physical_models ?? [];
  return (
    <>
      {measuredCount === 0 ? (
        <p className="mx-auto mt-3 max-w-[55rem] text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
          {rates === undefined
            ? "This controller publishes no measured rates, so no per-side price is shown at all."
            : "No model on this rig has been measured, so no per-side price is shown. An unmeasured model does not borrow a measured one's rate, and the combined figure cannot be divided into one — that charges each side for the other side's energy."}
        </p>
      ) : null}
      {unmeasured.length > 0 ? (
        <p className="mx-auto mt-3 max-w-[55rem] text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
          Not measured: {usageModelLabels(unmeasured, filters).join(", ")}. Named rather than left
          blank — &ldquo;nobody measured this&rdquo; and &ldquo;this costs nothing&rdquo; are
          different statements. An unmeasured model does not borrow a measured one&rsquo;s rate, and
          the combined figure is not divided into one.
        </p>
      ) : null}
    </>
  );
}

function EfficiencyHistory({
  efficiency,
  cells,
  filters,
  rates,
  preferences,
}: {
  efficiency: UsageEfficiency;
  cells: ActivityCell[];
  filters: UsageFilters | undefined;
  rates: UsageEnergyRates | undefined;
  preferences: EnergyPreferences;
}) {
  return (
    <>
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
      <ByModelBlock
        efficiency={efficiency}
        rates={rates}
        preferences={preferences}
        filters={filters}
      />
    </>
  );
}

export function UsageEfficiencyTab({
  efficiency,
  tokens,
  rates,
  filters,
  preferences,
  onPreferences,
}: {
  efficiency: UsageEfficiency | undefined;
  tokens: UsageTokens;
  rates: UsageEnergyRates | undefined;
  filters: UsageFilters | undefined;
  preferences: EnergyPreferences;
  onPreferences: (next: EnergyPreferences) => void;
}) {
  // Date.now() in render is an SSR/client mismatch; only the relative age clause is
  // client-only, and the absolute date always renders.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useMountSubscription(() => setNowMs(Date.now()), []);

  const totals = efficiency?.totals ?? null;
  const ratio = totals !== null && totals.tokens_per_kwh !== null;
  const measuredRates = rates?.measured ? rates.by_physical_model : [];
  const { rate, reason } = pickRate(rates, filters);
  const priced = rate === null ? null : pricedTraffic(tokens, rate, filters);
  const benchRates = rate === null ? measuredRates : [rate];
  // A card that is not the rate the page is scoped to must carry its model name, or a rig
  // filtered to an unmeasured model shows another model's numbers titled "Bench rate".
  const named = rate === null || benchRates.length > 1;
  const selectedModelLabel = usageModelLabel(filters?.model ?? "", filters);

  return (
    <>
      <EfficiencyHero
        rate={rate}
        reason={reason}
        totals={totals}
        ratesPublished={rates !== undefined}
        preferences={preferences}
        nowMs={nowMs}
        modelLabel={rate ? usageModelLabel(rate.model, filters) : selectedModelLabel}
      />

      {preferences.pricePerKwh === null ? (
        <div id="efficiency-tariff" className="mx-auto mt-5 max-w-[26rem]">
          <EnergySettings preferences={preferences} onChange={onPreferences} />
        </div>
      ) : null}

      {totals !== null && ratio ? (
        <EfficiencyStrip totals={totals} rate={rate} priced={priced} preferences={preferences} />
      ) : null}

      <ProvenanceLegend
        measured={benchRates.length > 0}
        traffic={ratio}
        modelled={priced !== null && ratio}
      />

      <EfficiencyCards
        totals={totals}
        tokens={tokens}
        rate={rate}
        priced={priced}
        benchRates={benchRates}
        named={named}
        nowMs={nowMs}
        filters={filters}
        preferences={preferences}
      />

      {benchRates.map((entry) => (
        <BenchProvenance
          key={entry.model}
          rate={entry}
          preferences={preferences}
          modelLabel={usageModelLabel(entry.model, filters)}
        />
      ))}

      <BenchNotes rates={rates} measuredCount={measuredRates.length} filters={filters} />

      {efficiency !== undefined && ratio ? (
        <EfficiencyHistory
          efficiency={efficiency}
          cells={dailyCells(efficiency, preferences)}
          filters={filters}
          rates={rates}
          preferences={preferences}
        />
      ) : (
        <EmptyNote>
          {benchRates.length > 0
            ? "Efficiency needs both measured GPU energy and processed tokens in this period. One of them is missing, so no ratio is shown rather than a misleading one. The rates above are a bench measurement and are just as true on a rig whose telemetry has nothing to say yet."
            : "Efficiency needs both measured GPU energy and processed tokens in this period, and no per-side rate is available either. Nothing is estimated in their place."}
        </EmptyNote>
      )}
    </>
  );
}
