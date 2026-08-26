"use client";

import type { EnergyPreferences } from "@/features/usage/energy-preferences";
import { BenchRateCard, excludedByRates } from "@/features/usage/usage-efficiency-rates";
import {
  effectiveEnergy,
  benchAgeDays,
  partialClause,
  plural,
  product,
  whFor,
  type EfficiencyTotals,
  type PricedTraffic,
} from "@/features/usage/usage-efficiency-pricing";
import { MetricRows, PanelCard, PanelGrid } from "@/features/usage/usage-panels";
import {
  compactTokens,
  decimals,
  exactNumber,
  kilowattHours,
  money,
  percent,
  perKwh,
  tokensPerSecond,
  UNAVAILABLE,
} from "@/features/usage/usage-formatters";
import type { UsageEnergyRate, UsageFilters, UsageTokens } from "@/lib/types";
import { usageModelLabel, usageModelLabels } from "@/features/usage/usage-model-identity";

function PeriodCard({
  totals,
  tokens,
  preferences,
}: {
  totals: EfficiencyTotals;
  tokens: UsageTokens;
  preferences: EnergyPreferences;
}) {
  const { currency, pricePerKwh: price } = preferences;
  // Which family of figures the owner asked for. Off by default means these rows carry the
  // slice inference caused, not the board's whole draw — see effectiveEnergy.
  const eff = effectiveEnergy(totals, preferences.grossEnergy);
  const scope = eff.attributed ? "inference only" : "idle included";
  return (
    <PanelCard
      title="This period"
      badge={eff.attributed ? "Your traffic · inference" : "Your traffic · gross"}
      description={
        eff.partial
          ? `${partialClause(totals)}. Every energy row below covers that fraction only — GPU energy and period cost are floors, not the period's bill — and because the token counts span the whole period, tokens per kWh reads high and the per-1M rows read low.`
          : eff.attributed
            ? "Measured across the full period, counting only what inference caused. Your meter reads the larger gross; turn on “charge the board’s whole draw” to see it."
            : "Measured across the full period, every watt the board drew."
      }
    >
      <MetricRows
        metrics={[
          { label: "Processed tokens", value: compactTokens(totals.processed_tokens) },
          {
            label: eff.attributed ? "Inference energy" : "GPU energy",
            value: kilowattHours(eff.energyKwh),
            hint: eff.lowerBound
              ? "A resident model has no measured idle floor, so its energy is in the gross and in no bucket. This figure is a floor."
              : undefined,
          },
          {
            label: "Energy per 1M processed",
            value: decimals(eff.kwhPerMillion, 3, " kWh"),
            hint: `Combined: board energy over all processed tokens, ${scope}. Not the sum of the two bench rates.`,
          },
          { label: "Tokens per kWh", value: perKwh(eff.tokensPerKwh) },
          {
            label: "Cost per 1M processed",
            value: money(product(eff.kwhPerMillion, price), currency, 4),
            hint: `Combined and ${scope}, so it is a different measurement from the per-side bench rates, not a merge of them.`,
          },
          {
            label: "Period cost",
            value: money(product(eff.energyKwh, price), currency),
            hint: eff.partial
              ? "Only the sampled seconds of this period are in it, so it is a floor rather than the bill."
              : eff.attributed
                ? "What inference caused across this period. The bill is the larger gross."
                : "Every measured second of this period, idle included.",
          },
          { label: "Requests", value: exactNumber(tokens.totals.requests) },
          {
            label: "Decode",
            value: tokensPerSecond(tokens.performance.decode_tps),
            hint: "One token per forward pass, memory-bandwidth-bound.",
          },
          {
            label: "Prefill",
            value: tokensPerSecond(tokens.performance.prefill_tps),
            hint: "Thousands of tokens per forward pass, compute-bound.",
          },
        ]}
      />
    </PanelCard>
  );
}

function PricedCard({
  totals,
  priced,
  rate,
  preferences,
  filters,
}: {
  totals: EfficiencyTotals;
  priced: PricedTraffic;
  rate: UsageEnergyRate;
  preferences: EnergyPreferences;
  filters: UsageFilters | undefined;
}) {
  const { currency, pricePerKwh: price } = preferences;
  const { fresh, generated, unpriced } = priced;
  const inputWh = whFor(fresh, rate.wh_per_1m_input);
  const outputWh = whFor(generated, rate.wh_per_1m_output);
  const marginalWh = inputWh + outputWh;

  // measured - modelled goes negative whenever coverage is partial: the token counts span
  // the whole period and the measured energy spans only the sampled fraction. A ratio is
  // meaningful in both directions; a difference would render a lie with a minus sign. And
  // board energy covers every model that ran, so the ratio is not one when a model these
  // rates cannot price also drew from the card.
  // COMPARE MARGINAL WITH MARGINAL. `marginalWh` is modelled from the bench rates, which are
  // above-idle by construction. Divided by the GROSS it reads as a small fraction of a number
  // that mostly is not inference — on this rig two thirds of board energy is idle and other
  // work — which makes a correct model look wrong. In AI mode both sides now exclude idle, so
  // the ratio answers the question it appears to ask.
  const measured = effectiveEnergy(totals, preferences.grossEnergy);
  const blocked =
    unpriced.length > 0
      ? "board energy covers every model that ran and these rates price only the measured one."
      : measured.partial
        ? "the token counts span the whole period and the measured energy does not."
        : null;
  const explained =
    blocked !== null || measured.energyKwh === null || measured.energyKwh <= 0
      ? null
      : (marginalWh / 1000 / measured.energyKwh) * 100;

  const mix =
    generated > 0
      ? `Your ${(fresh / generated).toFixed(1)} : 1 prompt-to-answer mix at the bench rate.`
      : "Your prompt and answer token counts at the bench rate.";
  // Same as the strip: only a marginal scope makes this a floor beneath the board total.
  const relation = excludedByRates([rate]).includes("idle draw")
    ? "Marginal only — it will not add up to the board total."
    : "A different measurement from the board total — the two do not add up.";
  const scoped =
    unpriced.length === 0
      ? ""
      : ` ${usageModelLabels(priced.unpriced, filters).join(", ")} also ran this period and ${plural(unpriced, "is", "are")} not priced here: no bench run measured ${plural(unpriced, "it", "them")}.`;

  return (
    <PanelCard
      title="Your traffic, priced"
      badge="Modelled"
      description={`${mix} ${relation}${scoped}${
        blocked === null ? "" : ` Modelled / measured is left blank because ${blocked}`
      }`}
    >
      <MetricRows
        metrics={[
          { label: "Tokens priced", value: compactTokens(fresh + generated) },
          { label: "Prompt (fresh)", value: compactTokens(fresh) },
          { label: "Generated", value: compactTokens(generated) },
          { label: "Input energy", value: decimals(inputWh, 1, " Wh") },
          { label: "Output energy", value: decimals(outputWh, 1, " Wh") },
          {
            label: "Input cost",
            value: money(price === null ? null : (inputWh / 1000) * price, currency, 4),
          },
          {
            label: "Output cost",
            value: money(price === null ? null : (outputWh / 1000) * price, currency, 4),
          },
          {
            label: "Input share",
            value: marginalWh > 0 ? percent((inputWh / marginalWh) * 100, 1) : UNAVAILABLE,
          },
          {
            label: "Modelled / measured",
            value: explained === null ? UNAVAILABLE : percent(explained, 1),
            hint:
              blocked === null
                ? "How much of the board energy this period the bench rates explain. The rest is idle draw, model loading, and GPU work that was not a request."
                : `Left blank because ${blocked}`,
          },
        ]}
      />
    </PanelCard>
  );
}

function CacheCard({
  totals,
  tokens,
  rate,
  traffic,
  filters,
  preferences,
}: {
  totals: EfficiencyTotals;
  tokens: UsageTokens;
  rate: UsageEnergyRate | null;
  traffic: PricedTraffic | null;
  filters: UsageFilters | undefined;
  preferences: EnergyPreferences;
}) {
  const { currency, pricePerKwh: price } = preferences;
  const fresh = tokens.totals.fresh_prompt_tokens;
  const cached = tokens.totals.cached_input_tokens;
  const prompt = fresh + cached;
  // This card renders on telemetry alone, so it must not talk about "the bench sample" or
  // "the input side above" when neither is anywhere on the page.
  const cachedPriced = rate !== null && rate.cached_input_priced;
  const description =
    rate === null
      ? "Cached prompt tokens are reuse, not fresh work, so they are outside the processed-token count."
      : cachedPriced
        ? "Cache hits are priced by the bench sample, so the input side above covers the whole prompt."
        : "Cache hits are not priced by the bench sample, so the input side above is a floor, not a total.";
  // "Priced share" is a claim about THESE counts, and they are the whole filtered period's
  // prompt: under "all models" they span aliases no bench rate covers, so a further slice
  // carries no price for a second reason and naming the fresh share the priced share
  // overstates what was priced — the borrowing the strip and the by-model table refuse.
  const pricedShare =
    rate !== null && !cachedPriced && traffic !== null && traffic.unpriced.length === 0;
  return (
    <PanelCard title="Cache and coverage" badge="Your traffic" description={description}>
      <MetricRows
        metrics={[
          { label: "Cached input", value: compactTokens(cached) },
          { label: "Fresh input", value: compactTokens(fresh) },
          {
            label: pricedShare ? "Priced share of prompt" : "Fresh share of prompt",
            value: prompt > 0 ? percent((fresh / prompt) * 100, 1) : UNAVAILABLE,
            hint: pricedShare
              ? "Fresh prompt tokens over all prompt tokens. Only this share carries a price at all."
              : "Fresh prompt tokens over all prompt tokens.",
          },
          { label: "Cache hit", value: percent(tokens.totals.cache_hit_rate) },
          { label: "Logical prompt", value: compactTokens(tokens.totals.logical_prompt_tokens) },
          { label: "Coverage", value: percent(totals.coverage_pct) },
          {
            label: "Denominator",
            value: totals.partial ? "partial" : "complete",
            hint: "Partial means only a fraction of the period had GPU power samples.",
          },
          {
            label: "Energy sample grain",
            value: decimals(filters?.energy_sample_interval_s ?? null, 0, " s"),
            hint: "Energy samples carry no request id and have this grain, so a total cannot be split between reading a prompt and writing an answer. That is why the per-side rates are measured on a bench instead.",
          },
          {
            label: "Rate applied",
            value: price === null ? UNAVAILABLE : `${money(price, currency, 4)} / kWh`,
          },
        ]}
      />
    </PanelCard>
  );
}

function BenchCardList({
  benchRates,
  named,
  nowMs,
  preferences,
  filters,
}: {
  benchRates: UsageEnergyRate[];
  named: boolean;
  nowMs: number | null;
  preferences: EnergyPreferences;
  filters: UsageFilters | undefined;
}) {
  return (
    <>
      {benchRates.map((entry) => {
        // Each card ages on its OWN measurement. Deriving the badge from the picked rate hid
        // staleness entirely on any rig with two measured models, where nothing is picked.
        const days = benchAgeDays(entry.measured_at, nowMs);
        return (
          <BenchRateCard
            key={entry.model}
            title={named ? usageModelLabel(entry.model, filters) : "Bench rate"}
            badge={days !== null && days >= 180 ? "Measured · aged" : "Measured"}
            rate={entry}
            preferences={preferences}
          />
        );
      })}
    </>
  );
}

export function EfficiencyCards({
  totals,
  tokens,
  rate,
  priced,
  benchRates,
  named,
  nowMs,
  filters,
  preferences,
}: {
  totals: EfficiencyTotals | null;
  tokens: UsageTokens;
  rate: UsageEnergyRate | null;
  priced: PricedTraffic | null;
  benchRates: UsageEnergyRate[];
  named: boolean;
  nowMs: number | null;
  filters: UsageFilters | undefined;
  preferences: EnergyPreferences;
}) {
  const list = (
    <BenchCardList
      benchRates={benchRates}
      named={named}
      nowMs={nowMs}
      preferences={preferences}
      filters={filters}
    />
  );
  // Gated on the SAME family the cards will render, or a rig with gross data but no measured
  // idle floor would collapse to the bench list while holding figures it could have shown.
  if (totals === null || effectiveEnergy(totals, preferences.grossEnergy).tokensPerKwh === null) {
    return benchRates.length === 0 ? null : (
      <section className="mx-auto mt-5 grid max-w-[34rem] gap-3">{list}</section>
    );
  }
  return (
    <PanelGrid columns={2}>
      {list}
      <PeriodCard totals={totals} tokens={tokens} preferences={preferences} />
      {rate === null || priced === null ? null : (
        <PricedCard
          totals={totals}
          priced={priced}
          rate={rate}
          preferences={preferences}
          filters={filters}
        />
      )}
      <CacheCard
        totals={totals}
        tokens={tokens}
        rate={rate}
        traffic={priced}
        filters={filters}
        preferences={preferences}
      />
    </PanelGrid>
  );
}
