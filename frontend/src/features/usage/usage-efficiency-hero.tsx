"use client";

import type { EnergyPreferences } from "@/features/usage/energy-preferences";
import {
  effectiveEnergy,
  benchAgeDays,
  heroFootnote,
  partialClause,
  product,
  stripFootnote,
  stripMetrics,
  type EfficiencyTotals,
  type PricedTraffic,
} from "@/features/usage/usage-efficiency-pricing";
import { HeroMetric, HeroSplit, MetricStrip } from "@/features/usage/usage-panels";
import { decimals, money, UNAVAILABLE } from "@/features/usage/usage-formatters";
import type { UsageEnergyRate } from "@/lib/types";

function BenchHero({
  rate,
  preferences,
  nowMs,
}: {
  rate: UsageEnergyRate;
  preferences: EnergyPreferences;
  nowMs: number | null;
}) {
  const { currency, pricePerKwh: price } = preferences;
  const whIn = rate.wh_per_1m_input;
  const whOut = rate.wh_per_1m_output;
  const peak = Math.max(whIn, whOut);
  const share = (wh: number) => (peak > 0 ? Math.max(2, (wh / peak) * 100) : 2);
  const unpriced = "set a rate to price it";

  return (
    <HeroSplit
      left={{
        label: "Input · 1M prompt tokens",
        value:
          price === null ? decimals(whIn, 1, " Wh") : money((whIn / 1000) * price, currency, 4),
        sub: price === null ? unpriced : decimals(whIn, 1, " Wh"),
        share: share(whIn),
      }}
      right={{
        label: "Output · 1M generated tokens",
        value:
          price === null ? decimals(whOut, 1, " Wh") : money((whOut / 1000) * price, currency, 4),
        sub: price === null ? unpriced : decimals(whOut, 1, " Wh"),
        share: share(whOut),
      }}
      link={{
        value: whIn > 0 ? `${(whOut / whIn).toFixed(1)}×` : UNAVAILABLE,
        label: "output / input",
      }}
      caption={
        price === null ? (
          <>
            Energy for one million tokens on {rate.model}. Set your electricity rate{" "}
            <a
              className="underline underline-offset-2 hover:text-(--ui-fg)"
              href="#efficiency-tariff"
            >
              below
            </a>{" "}
            to see this in {currency}.
          </>
        ) : (
          `Electricity for one million tokens on ${rate.model}, at your ${money(price, currency, 4)} per kWh. Reading a prompt and writing an answer are not the same price.`
        )
      }
      footnote={heroFootnote(rate, preferences.timezone, benchAgeDays(rate.measured_at, nowMs))}
    />
  );
}

function CombinedHero({
  totals,
  ratesPublished,
  preferences,
}: {
  totals: EfficiencyTotals;
  ratesPublished: boolean;
  preferences: EnergyPreferences;
}) {
  const { currency, pricePerKwh: price } = preferences;
  const eff = effectiveEnergy(totals, preferences.grossEnergy);
  // This hero is pure telemetry, unlike the bench hero: under partial coverage its numerator
  // is the sampled seconds while its denominator is the whole period's tokens, so the figure
  // is understated by roughly the inverse of the coverage.
  const scope = eff.attributed
    ? "counting only what inference caused"
    : "every watt the board drew, idle included";
  const head = eff.partial
    ? `Combined, not split: board energy over processed tokens, ${scope}. ${partialClause(totals)}, so the energy is from the sampled seconds while the tokens span the whole period — this reads low.`
    : `Combined, not split: board energy over every token it processed, ${scope}.`;
  const why = ratesPublished
    ? "No bench run has measured this rig's per-side rates, and the split cannot be recovered from telemetry."
    : "This controller publishes no measured per-side rates at all, and the split cannot be recovered from telemetry.";
  const caption = `${head} ${why}${
    price === null ? ` Set your electricity rate below to see this in ${currency}.` : ""
  }`;
  return price === null ? (
    <HeroMetric
      value={decimals(eff.kwhPerMillion, 3, " kWh")}
      label="Energy per 1M processed tokens"
      caption={caption}
    />
  ) : (
    <HeroMetric
      value={money(product(eff.kwhPerMillion, price), currency, 4)}
      label="Cost per 1M processed tokens"
      caption={caption}
    />
  );
}

export function EfficiencyHero({
  rate,
  reason,
  totals,
  selected,
  ratesPublished,
  preferences,
  nowMs,
}: {
  rate: UsageEnergyRate | null;
  reason: "unmeasured" | "ambiguous" | null;
  totals: EfficiencyTotals | null;
  selected: string;
  ratesPublished: boolean;
  preferences: EnergyPreferences;
  nowMs: number | null;
}) {
  if (rate !== null) return <BenchHero rate={rate} preferences={preferences} nowMs={nowMs} />;
  if (reason === "unmeasured") {
    return (
      <HeroMetric
        value={UNAVAILABLE}
        label="Cost per 1M tokens"
        caption={`No bench run has measured ${selected}, so it has no per-side price. An unmeasured model does not borrow a measured one's rate, and the combined figure is not divided into one.`}
      />
    );
  }
  if (reason === "ambiguous") {
    return (
      <HeroMetric
        value={UNAVAILABLE}
        label="Cost per 1M tokens"
        caption="This rig has more than one measured model and they do not share a price. Choose a model above to see its input and output rate."
      />
    );
  }
  // The gate asks the SAME family the hero will render. Gated on the gross while showing the
  // attributable figure, a rig with gross data but no idle floor would paint an empty hero.
  if (totals !== null && effectiveEnergy(totals, preferences.grossEnergy).tokensPerKwh !== null) {
    return (
      <CombinedHero totals={totals} ratesPublished={ratesPublished} preferences={preferences} />
    );
  }
  return <HeroMetric value={UNAVAILABLE} label="Cost per 1M processed tokens" />;
}

export function EfficiencyStrip({
  totals,
  rate,
  priced,
  preferences,
}: {
  totals: EfficiencyTotals;
  rate: UsageEnergyRate | null;
  priced: PricedTraffic | null;
  preferences: EnergyPreferences;
}) {
  return (
    <>
      <MetricStrip metrics={stripMetrics(totals, rate, priced, preferences)} />
      <p className="mx-auto mt-2 max-w-[55rem] text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
        {stripFootnote(totals, rate, priced, preferences.pricePerKwh)}
      </p>
    </>
  );
}
