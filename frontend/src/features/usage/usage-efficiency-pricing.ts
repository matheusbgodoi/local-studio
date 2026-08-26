import type { ActivityCell } from "@/features/usage/activity-heatmap";
import type { EnergyPreferences } from "@/features/usage/energy-preferences";
import { excludedByRates } from "@/features/usage/usage-efficiency-rates";
import type { Metric } from "@/features/usage/usage-panels";
import {
  compactTokens,
  decimals,
  instantLabel,
  kilowattHours,
  money,
  percent,
  perKwh,
} from "@/features/usage/usage-formatters";
import type {
  UsageEfficiency,
  UsageEfficiencyRatios,
  UsageEnergyRate,
  UsageFilters,
  UsageTokens,
} from "@/lib/types";

export type EfficiencyTotals = UsageEfficiency["totals"];

export const product = (left: number | null, right: number | null): number | null =>
  left === null || right === null ? null : left * right;

export const whFor = (tokens: number, whPerMillion: number): number =>
  (tokens / 1_000_000) * whPerMillion;

export const plural = (items: string[], one: string, many: string): string =>
  items.length === 1 ? one : many;

/** `energy_kwh` covers only the sampled seconds; the token counts cover the whole period. */
export function partialClause(totals: EfficiencyTotals): string {
  return totals.coverage_pct === null
    ? "Only part of this period had GPU power samples"
    : `Only ${percent(totals.coverage_pct)} of this period had GPU power samples`;
}

export function benchAgeDays(measuredAt: string | null, nowMs: number | null): number | null {
  if (measuredAt === null || nowMs === null) return null;
  const at = Date.parse(measuredAt);
  return Number.isNaN(at) ? null : Math.floor((nowMs - at) / 86_400_000);
}

function ageClause(days: number | null): string {
  if (days === null || days < 0) return "";
  if (days < 1) return " (today)";
  if (days === 1) return " (yesterday)";
  if (days < 30) return ` (${days} days ago)`;
  if (days < 365) return ` (${Math.round(days / 30)} months ago)`;
  return " (over a year ago)";
}

/** Invariants A, B and C in one line: measured not derived, when, and what the payload excludes. */
export function heroFootnote(rate: UsageEnergyRate, timezone: string, days: number | null): string {
  const measuredAt = instantLabel(rate.measured_at, timezone);
  const head = [
    measuredAt === null
      ? "Measured on this rig"
      : `Measured on this rig ${measuredAt}${ageClause(days)}`,
    rate.significant_figures === null
      ? null
      : `to about ${rate.significant_figures} significant figures`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  // Every exclusion here is read off the payload. A config with scope "total" has idle
  // INSIDE these rates, and the old fixed clause told the reader to add an idle charge that
  // was already priced.
  const scope =
    rate.scope === "marginal"
      ? "Marginal"
      : rate.scope === null
        ? "Scope not stated"
        : `Scope "${rate.scope}"`;
  const source =
    rate.energy_source === "gpu_board_power"
      ? "GPU board power only"
      : rate.energy_source === null
        ? "power source not stated"
        : `energy source "${rate.energy_source}"`;
  const excluded = excludedByRates([rate]);
  const tail =
    excluded.length === 0
      ? "what it leaves out is not stated, so read the disclosure below before trusting it."
      : `${excluded.join(", ")} ${plural(excluded, "is", "are")} not in it.`;
  const aged =
    days !== null && days >= 180
      ? " This measurement is over six months old. A change to the model, quant, context length or speculation settings since then would make it a different measurement."
      : "";
  return `${head}. ${scope}, ${source} — ${tail}${aged}`;
}

export interface PricedTraffic {
  fresh: number;
  generated: number;
  /** Aliases with traffic this period that this rate does not cover. Named, never priced. */
  unpriced: string[];
}

export function effectiveRatios(
  ratios: UsageEfficiencyRatios,
  grossEnergy: boolean,
): {
  energyKwh: number | null;
  tokensPerKwh: number | null;
  kwhPerMillion: number | null;
} {
  return grossEnergy
    ? {
        energyKwh: ratios.energy_kwh,
        tokensPerKwh: ratios.tokens_per_kwh,
        kwhPerMillion: ratios.kwh_per_million_processed,
      }
    : {
        energyKwh: ratios.inference_kwh,
        tokensPerKwh: ratios.tokens_per_kwh_inference,
        kwhPerMillion: ratios.kwh_per_million_processed_inference,
      };
}

/**
 * The tokens one bench rate is allowed to price, and the aliases it is not.
 *
 * `tokens.totals` is scoped by the model filter, so under "all models" it spans every alias
 * on the rig. Multiplying it whole by one physical model's Wh charges every other model's
 * traffic at this model's rate: on a rig whose second model decodes at three times the cost
 * and served half the period's tokens, that understates the electricity by about half — the
 * borrowing the by-model table already refuses by rendering an em dash.
 */
export function pricedTraffic(
  tokens: UsageTokens,
  rate: UsageEnergyRate,
  filters: UsageFilters | undefined,
): PricedTraffic | null {
  const covers = (model: string) => rate.aliases.includes(model);
  if (covers(filters?.model ?? "")) {
    return {
      fresh: tokens.totals.fresh_prompt_tokens,
      generated: tokens.totals.generated_tokens,
      unpriced: [],
    };
  }
  const priced = tokens.by_model.filter((entry) => covers(entry.model));
  const unpriced = tokens.by_model
    .filter((entry) => !covers(entry.model) && entry.processed_tokens > 0)
    .map((entry) => entry.model);
  const fresh = priced.reduce((sum, entry) => sum + entry.fresh_prompt_tokens, 0);
  const generated = priced.reduce((sum, entry) => sum + entry.generated_tokens, 0);
  // Nothing attributable: either no traffic ran on the measured model, or the payload has no
  // per-model split to attribute the totals with. A price here would be a guess.
  return fresh + generated === 0 ? null : { fresh, generated, unpriced };
}

/**
 * One branching function, not three array literals: three near-identical six-tile literals
 * are what jscpd's 30-line threshold exists to catch.
 */
export function stripMetrics(
  totals: EfficiencyTotals,
  rate: UsageEnergyRate | null,
  priced: PricedTraffic | null,
  preferences: EnergyPreferences,
): Metric[] {
  const { currency, pricePerKwh: price } = preferences;
  const selected = effectiveEnergy(totals, preferences.grossEnergy);
  const energyLabel = selected.attributed ? "Inference energy" : "GPU energy";
  const costLabel = selected.attributed ? "Inference cost" : "Board cost";
  const processed = { label: "Processed", value: compactTokens(totals.processed_tokens) };
  const coverage = { label: "Coverage", value: percent(totals.coverage_pct) };

  if (rate !== null && priced !== null) {
    const inputWh = whFor(priced.fresh, rate.wh_per_1m_input);
    const outputWh = whFor(priced.generated, rate.wh_per_1m_output);
    if (price === null) {
      return [
        { label: "Input energy", value: decimals(inputWh, 1, " Wh") },
        { label: "Output energy", value: decimals(outputWh, 1, " Wh") },
        { label: "Request energy", value: decimals(inputWh + outputWh, 1, " Wh") },
        { label: energyLabel, value: kilowattHours(selected.energyKwh) },
        processed,
        coverage,
      ];
    }
    return [
      { label: "Input cost", value: money((inputWh / 1000) * price, currency, 4) },
      { label: "Output cost", value: money((outputWh / 1000) * price, currency, 4) },
      { label: "Request cost", value: money(((inputWh + outputWh) / 1000) * price, currency, 4) },
      { label: costLabel, value: money(product(selected.energyKwh, price), currency) },
      processed,
      coverage,
    ];
  }

  return [
    processed,
    { label: energyLabel, value: kilowattHours(selected.energyKwh) },
    price === null
      ? { label: "Tokens / kWh", value: perKwh(selected.tokensPerKwh) }
      : { label: costLabel, value: money(product(selected.energyKwh, price), currency) },
    { label: "Per 1M", value: decimals(selected.kwhPerMillion, 3, " kWh") },
    price === null
      ? { label: "Denominator", value: selected.partial ? "partial" : "complete" }
      : {
          label: "Cost / 1M",
          value: money(product(selected.kwhPerMillion, price), currency, 4),
        },
    coverage,
  ];
}

function selectedFigureLabel(attributed: boolean, priced: boolean): string {
  if (attributed) return priced ? "Inference cost" : "Inference energy";
  return priced ? "Board cost" : "Board energy";
}

function selectedRatiosUnavailable(selected: ReturnType<typeof effectiveEnergy>): boolean {
  return (
    selected.energyKwh === null || selected.tokensPerKwh === null || selected.kwhPerMillion === null
  );
}

export function stripFootnote(
  totals: EfficiencyTotals,
  rate: UsageEnergyRate | null,
  priced: PricedTraffic | null,
  preferences: EnergyPreferences,
): string {
  const { pricePerKwh: price } = preferences;
  const selected = effectiveEnergy(totals, preferences.grossEnergy);
  const scope = selected.attributed ? "inference energy" : "board energy";
  const selectedFigure = selectedFigureLabel(selected.attributed, price !== null);
  if (selected.attributed && selectedRatiosUnavailable(selected)) {
    const modelled =
      rate !== null && priced !== null
        ? " The input, output, and request figures are modelled from the separate bench rate."
        : "";
    return `Inference-only telemetry is unavailable for this period. Dynamic energy and efficiency tiles show an em dash rather than falling back to GPU board totals.${modelled}`;
  }
  // Under partial coverage `energy_kwh` is the sampled seconds only, so the board figure is
  // a floor — and the per-side figures beside it can exceed it for that reason alone.
  const floor = selected.partial
    ? `${selectedFigure} covers only the sampled part of this period${
        totals.coverage_pct === null ? "" : ` (${percent(totals.coverage_pct)})`
      }, so it is a floor rather than the period's bill`
    : selected.attributed
      ? `${selectedFigure} is the measured slice caused by inference, idle excluded`
      : `${selectedFigure} is what the card actually drew, idle included`;
  if (rate === null || priced === null) {
    const denominator = selected.partial
      ? " The token counts span the whole period, so tokens per kWh reads high and the per-1M figures read low."
      : "";
    return `Every tile here is this period's telemetry: measured ${scope} over all processed tokens${selected.attributed ? ", idle excluded" : ", idle included"}. ${floor}.${denominator}`;
  }
  const measured = `${floor}${
    selected.partial ? ", and can read lower than the three figures beside it" : ""
  }.`;
  const scoped =
    priced.unpriced.length === 0
      ? ""
      : ` They cover the measured model only: ${priced.unpriced.join(", ")} also ran this period and ${plural(priced.unpriced, "its", "their")} tokens are not in them, because no bench run measured ${plural(priced.unpriced, "it", "them")}.`;
  // "Marginal" is a claim only `scope: "marginal"` backs; without it the bench rate may
  // already carry idle and the reader must not be told the two figures are disjoint.
  const relation = excludedByRates([rate]).includes("idle draw")
    ? `marginal, so they do not add up to the ${selectedFigure.toLowerCase()}`
    : `a different measurement from the ${selectedFigure.toLowerCase()}, so the two do not add up`;
  return `The first three are your token counts ${
    price === null ? "at" : "priced at"
  } the bench rate below, ${relation}.${scoped} ${measured}`;
}

export function dailyCells(
  efficiency: UsageEfficiency | undefined,
  preferences: EnergyPreferences,
): ActivityCell[] {
  const { currency, pricePerKwh: price } = preferences;
  return (efficiency?.daily ?? []).map((day): ActivityCell => {
    const selected = effectiveRatios(day, preferences.grossEnergy);
    return {
      date: day.date,
      value: selected.tokensPerKwh,
      summary: [
        `${perKwh(selected.tokensPerKwh)} tokens/kWh`,
        `${decimals(selected.kwhPerMillion, 3)} kWh per 1M`,
        price === null
          ? "rate not set"
          : `${money(product(selected.kwhPerMillion, price), currency, 4)} per 1M`,
        `${compactTokens(day.processed_tokens)} processed`,
        kilowattHours(selected.energyKwh),
        `coverage ${percent(day.coverage_pct)}`,
      ].join(" · "),
    };
  });
}

/**
 * The figures the screen should use, given the owner's AI-mode choice.
 *
 * The report publishes both families side by side — gross (`energy_kwh`, `tokens_per_kwh`,
 * `kwh_per_million_processed`) and attributable (`*_inference`) — rather than one switched
 * server-side, so the client can offer the toggle without a refetch and so neither figure can
 * be mistaken for the other in the payload.
 *
 * AI MODE IS AN ATTRIBUTION, NOT A DISCOUNT. The meter bills the gross; this says how much of
 * it inference caused. Measured on this rig, the difference is not cosmetic: 24 of 42 resident
 * hours ran under 5% utilisation, and a single day held a model loaded for 7.3 hours at 1.5%,
 * burning 916 Wh that was being charged to tokens.
 *
 * A null attributable figure is returned as null, never silently swapped for the gross. The
 * two answer different questions, and a screen that quietly substitutes one for the other is
 * the borrowing this payload refuses everywhere else.
 */
export function effectiveEnergy(
  totals: EfficiencyTotals,
  grossEnergy: boolean,
): {
  energyKwh: number | null;
  tokensPerKwh: number | null;
  kwhPerMillion: number | null;
  partial: boolean;
  /** True when the number on screen is the attributable slice, not the board's whole draw. */
  attributed: boolean;
  /** True when a resident model had no measured idle floor, so inference is a floor itself. */
  lowerBound: boolean;
} {
  const selected = effectiveRatios(totals, grossEnergy);
  if (grossEnergy) {
    return {
      ...selected,
      partial: totals.partial,
      attributed: false,
      lowerBound: false,
    };
  }
  return {
    ...selected,
    partial: totals.partial_inference,
    attributed: true,
    lowerBound: totals.inference_is_lower_bound,
  };
}
