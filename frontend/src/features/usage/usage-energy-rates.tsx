"use client";

import type { EnergyPreferences } from "@/features/usage/energy-preferences";
import { EmptyNote, MetricRows, PanelCard, PanelGrid } from "@/features/usage/usage-panels";
import { decimals, money, UNAVAILABLE } from "@/features/usage/usage-formatters";
import type { UsageEnergyRate, UsageEnergyRates } from "@/lib/types";

/**
 * The MEASURED price of a token, per side, and what it costs at the configured tariff.
 *
 * This panel is deliberately not part of the efficiency grid above it. Everything there is
 * computed from the telemetry store; everything here is read off a bench run. Rendering the
 * two together without saying which is which would let a reader assume the split was
 * derived from their own traffic — it cannot be. The store's energy samples carry no
 * request id and have a 60-second grain, and most requests are shorter than a minute, so
 * there is no join between a request and its watts and no arithmetic that invents one.
 *
 * Every caveat the backend attaches is rendered. A marginal, GPU-board-only figure quoted
 * as if it were a bill is worse than no figure, because it looks like it was checked.
 */

/** Wh per 1M tokens -> currency per 1M tokens. kWh = Wh / 1000. */
function costPer1M(wh: number, pricePerKwh: number | null): number | null {
  return pricePerKwh === null ? null : (wh / 1000) * pricePerKwh;
}

function RateCard({
  rate,
  preferences,
}: {
  rate: UsageEnergyRate;
  preferences: EnergyPreferences;
}) {
  const price = preferences.pricePerKwh;
  const inputCost = costPer1M(rate.wh_per_1m_input, price);
  const outputCost = costPer1M(rate.wh_per_1m_output, price);

  // Both sides come from one fit, so the ratio is exact arithmetic on them, not a second
  // claim. It is worth showing: it is the whole reason the two cannot share one number.
  const ratio = rate.wh_per_1m_input > 0 ? rate.wh_per_1m_output / rate.wh_per_1m_input : null;

  const others = rate.aliases.filter((alias) => alias !== rate.model);

  return (
    <PanelCard
      title={rate.model}
      description={
        others.length > 0
          ? `Measured on ${rate.measured_on_alias ?? rate.model}. The same weights serve ${others.join(", ")}, which differ in adapter scale — that changes what a forward pass produces, not what it costs, so they share this rate.`
          : `Measured on ${rate.measured_on_alias ?? rate.model}.`
      }
    >
      <MetricRows
        metrics={[
          {
            label: "Input",
            value: `${decimals(rate.wh_per_1m_input, 1)} Wh per 1M`,
            hint: "Energy to prefill one million prompt tokens, above idle.",
          },
          {
            label: "Output",
            value: `${decimals(rate.wh_per_1m_output, 1)} Wh per 1M`,
            hint: "Energy to generate one million completion tokens, above idle.",
          },
          {
            label: "Output vs input",
            value: ratio === null ? UNAVAILABLE : `${ratio.toFixed(1)}× per token`,
            hint: "Prefill is compute-bound over thousands of tokens per forward pass; decode is memory-bandwidth-bound at one token per pass.",
          },
          {
            label: `Input · ${preferences.currency}`,
            value:
              price === null
                ? "set a price per kWh"
                : `${money(inputCost, preferences.currency, 4)} per 1M`,
            hint: "Marginal GPU electricity only.",
          },
          {
            label: `Output · ${preferences.currency}`,
            value:
              price === null
                ? "set a price per kWh"
                : `${money(outputCost, preferences.currency, 4)} per 1M`,
            hint: "Marginal GPU electricity only.",
          },
        ]}
      />

      <dl className="mt-4 space-y-1.5 border-t border-(--ui-border)/40 pt-3 text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
        {rate.idle_watts !== null ? (
          <div>
            Idle draw is <span className="tabular-nums">{decimals(rate.idle_watts, 1)} W</span> with
            the model resident and serving nothing, and is <strong>not</strong> included above.
          </div>
        ) : null}
        {rate.excludes.length > 0 ? <div>Excludes: {rate.excludes.join("; ")}.</div> : null}
        {!rate.cached_input_priced ? (
          <div>
            Cached input is <strong>not priced</strong> by this sample — every run defeated the
            prompt cache, so the input figure is the uncached price.
          </div>
        ) : null}
        {rate.notes.map((note) => (
          <div key={note}>{note}</div>
        ))}
        <div>
          {[
            rate.scope === "marginal" ? "Marginal (above idle)" : rate.scope,
            rate.energy_source === "gpu_board_power" ? "GPU board power only" : rate.energy_source,
            rate.significant_figures !== null
              ? `good to ~${rate.significant_figures} significant figures`
              : null,
            rate.context_tokens !== null
              ? `measured at ${rate.context_tokens.toLocaleString()} context`
              : null,
            rate.sample?.requests !== null && rate.sample?.requests !== undefined
              ? `${rate.sample.requests} requests`
              : null,
            rate.measured_at,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </dl>
    </PanelCard>
  );
}

export function UsageEnergyRatesPanel({
  rates,
  preferences,
}: {
  rates: UsageEnergyRates | undefined;
  preferences: EnergyPreferences;
}) {
  if (!rates) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
          Measured price of a token
        </h2>
        <p className="mt-1 max-w-prose text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
          Measured in a bench run, not derived from your traffic. The energy samples above carry no
          request id and have a one-minute grain, while most requests are shorter than that — so how
          a total splits between reading a prompt and writing an answer cannot be recovered from
          them, and is measured separately instead. A cost built from these is a floor, not a bill.
        </p>
      </div>

      {rates.measured ? (
        <PanelGrid>
          {rates.by_physical_model.map((rate) => (
            <RateCard key={rate.model} rate={rate} preferences={preferences} />
          ))}
        </PanelGrid>
      ) : (
        <EmptyNote>
          No model here has been measured, so no per-side price is shown. An unmeasured model does
          not borrow a measured one&rsquo;s rate, and the combined figure above cannot be divided
          into one — doing that charges each side for the other side&rsquo;s energy.
        </EmptyNote>
      )}

      {rates.unmeasured_physical_models.length > 0 && rates.measured ? (
        <EmptyNote>
          Not measured: {rates.unmeasured_physical_models.join(", ")}. Shown by name rather than
          left blank — &ldquo;nobody measured this&rdquo; and &ldquo;this costs nothing&rdquo; are
          different statements.
        </EmptyNote>
      ) : null}
    </section>
  );
}
