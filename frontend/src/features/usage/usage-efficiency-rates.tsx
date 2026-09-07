"use client";

import { Fragment } from "react";
import type { EnergyPreferences } from "@/features/usage/energy-preferences";
import { MetricRows, PanelCard } from "@/features/usage/usage-panels";
import {
  compactTokens,
  decimals,
  exactNumber,
  instantLabel,
  money,
  UNAVAILABLE,
} from "@/features/usage/usage-formatters";
import type { UsageEnergyRate, UsageEnergyRates, UsageFilters } from "@/lib/types";

/**
 * `notes` arrives as WRAPPED LINES, not sentences. Rendering one element per line chopped
 * every sentence mid-clause on screen. Blank entries are the file's own paragraph breaks —
 * the same convention its README array uses — and the normalizer preserves them, so they
 * are the only thing worth splitting on.
 */
export function paragraphs(lines: string[]): string[] {
  const groups: string[][] = [[]];
  for (const line of lines) {
    if (line.trim() === "") {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1].push(line.trim());
  }
  return groups
    .map((group) => group.join(" ").replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function sentenceList(items: string[]): string {
  const parts = items.map((item) => item.trim().replace(/\.+$/, "")).filter(Boolean);
  return parts.length === 0 ? "" : `${parts.join("; ")}.`;
}

/**
 * A rate, or none and why none.
 *
 * The hero needs the reason, not just the absence: "ambiguous" told a reader who had just
 * chosen a model in the dropdown to choose a model, because the two states were one.
 */
export interface RatePick {
  rate: UsageEnergyRate | null;
  /** "unmeasured": the wire lists this alias as served and no bench run covers it. */
  reason: "unmeasured" | "ambiguous" | null;
}

/**
 * One rate, or none. Two measured models do not average into a third, and a model no bench
 * run touched never borrows one that was measured.
 *
 * The single-measured-rate fallback is for the "all models" sentinel only, which is not an
 * alias and so matches nothing. Letting it fire for an alias the user explicitly picked
 * priced that model's traffic at another model's Wh — on this rig's own payload 58.1 in
 * and 1183.2 out — under a card badged "Measured", on the same screen that names it
 * unmeasured.
 */
export function pickRate(
  rates: UsageEnergyRates | undefined,
  filters: UsageFilters | undefined,
): RatePick {
  const measured = rates?.measured ? rates.by_physical_model : [];
  const selected = filters?.model ?? "";
  const matched = measured.filter((rate) => rate.aliases.includes(selected));
  if (matched.length === 1) return { rate: matched[0], reason: null };
  if (matched.length > 1) return { rate: null, reason: "ambiguous" };
  if ((filters?.supported_models ?? []).includes(selected)) {
    return { rate: null, reason: measured.length === 0 ? null : "unmeasured" };
  }
  if (measured.length === 1) return { rate: measured[0], reason: null };
  return { rate: null, reason: measured.length > 1 ? "ambiguous" : null };
}

/**
 * What the payload itself puts outside these rates — never more than that.
 *
 * `scope: "marginal"` is what means idle draw is excluded and `energy_source:
 * "gpu_board_power"` is what means the rest of the host is. A config that says "total", or
 * says nothing, backs neither claim: a reader told idle was excluded adds an idle charge
 * that is already inside the price.
 */
export function excludedByRates(rates: UsageEnergyRate[]): string[] {
  if (rates.length === 0) return [];
  return [
    rates.every((rate) => rate.scope === "marginal") ? "idle draw" : null,
    rates.every((rate) => rate.energy_source === "gpu_board_power") ? "the rest of the host" : null,
    rates.every((rate) => !rate.cached_input_priced) ? "cached input" : null,
  ].filter((part): part is string => part !== null);
}

export function BenchRateCard({
  title,
  badge,
  rate,
  preferences,
}: {
  title: string;
  badge: string;
  rate: UsageEnergyRate;
  preferences: EnergyPreferences;
}) {
  const { currency, pricePerKwh: price } = preferences;
  const ratio = rate.wh_per_1m_input > 0 ? rate.wh_per_1m_output / rate.wh_per_1m_input : null;
  const idleCost =
    rate.idle_watts === null || price === null ? null : (rate.idle_watts / 1000) * price;
  const sharedProfiles = rate.aliases.length > 1;
  const requests = rate.sample?.requests ?? null;
  const marginal = rate.scope === "marginal";

  const basis = "Read from a bench run on this rig, not derived from your traffic.";

  return (
    <PanelCard
      title={title}
      badge={badge}
      description={
        sharedProfiles
          ? `${basis} Every behavior profile backed by these same weights shares this one physical-model rate.`
          : basis
      }
    >
      <MetricRows
        metrics={[
          {
            label: "Input",
            value: decimals(rate.wh_per_1m_input, 1, " Wh / 1M"),
            hint: marginal
              ? "Energy to prefill one million prompt tokens, above idle."
              : "Energy to prefill one million prompt tokens.",
          },
          {
            label: "Output",
            value: decimals(rate.wh_per_1m_output, 1, " Wh / 1M"),
            hint: marginal
              ? "Energy to generate one million completion tokens, above idle."
              : "Energy to generate one million completion tokens.",
          },
          {
            label: "Output vs input",
            value: ratio === null ? UNAVAILABLE : `${ratio.toFixed(1)}× per token`,
            hint: "Prefill is compute-bound over thousands of tokens per forward pass; decode is memory-bandwidth-bound at one token per pass.",
          },
          {
            label: "Idle draw",
            value: decimals(rate.idle_watts, 1, " W"),
            // Only a marginal scope puts idle outside the two rates. Asserting it anyway
            // invites the reader to add a charge that is already in the number.
            hint: marginal
              ? "Board draw with the model resident and serving nothing. Excluded from the two rates above."
              : "Board draw with the model resident and serving nothing. This measurement does not state a marginal scope, so whether it is already inside the two rates above is unknown.",
          },
          {
            label: "Idle cost",
            value: idleCost === null ? UNAVAILABLE : `${money(idleCost, currency, 4)} / h`,
            hint:
              idleCost === null
                ? "Your rate times idle draw, charged whether or not a token is generated."
                : `Your rate times idle draw, charged whether or not a token is generated — about ${money(idleCost * 8, currency, 2)} over an eight-hour day with the model resident.`,
          },
          {
            label: "Bench context",
            value:
              rate.context_tokens === null
                ? UNAVAILABLE
                : `${compactTokens(rate.context_tokens)} tok`,
          },
          {
            label: "Sample",
            value: requests === null ? UNAVAILABLE : `${exactNumber(requests)} requests`,
          },
          {
            label: "Confidence",
            value:
              rate.significant_figures === null
                ? UNAVAILABLE
                : `~${rate.significant_figures} sig figs`,
          },
          {
            label: "Measured",
            value: instantLabel(rate.measured_at, preferences.timezone) ?? UNAVAILABLE,
          },
        ]}
      />
    </PanelCard>
  );
}

function glossary(rate: UsageEnergyRate): Array<{ term: string; detail: string }> {
  return [
    {
      term: "Idle cost",
      detail:
        rate.scope === "marginal"
          ? "Your rate times idle draw. It is charged whether or not a token is generated, and it is not in the per-side rates."
          : "Your rate times idle draw. It is charged whether or not a token is generated. Only a marginal scope keeps it out of the per-side rates, and this measurement does not state one.",
    },
    {
      term: "Modelled / measured",
      detail:
        "How much of the board energy this period the bench rates explain. The rest is idle draw, model loading, and GPU work that was not a request. Blank while coverage is partial, because the token counts span the whole period and the measured energy does not, and blank while a model the rates cannot price also ran.",
    },
    {
      term: "Denominator",
      detail:
        "Partial means only a fraction of the period had GPU power samples, so tokens per kWh reads high.",
    },
    {
      term: "Energy sample grain",
      detail:
        "How long one energy sample covers. Most requests are shorter, and the samples carry no request id.",
    },
    {
      term: "Priced share of prompt",
      detail: rate.cached_input_priced
        ? "Fresh prompt tokens over all prompt tokens. Cache hits are priced by the bench sample, so the input side covers the whole prompt."
        : "Fresh prompt tokens over all prompt tokens. Cache hits are not priced by the bench sample, so only this share carries a price at all.",
    },
  ];
}

export function BenchProvenance({
  rate,
  preferences,
  modelLabel,
}: {
  rate: UsageEnergyRate;
  preferences: EnergyPreferences;
  modelLabel: string;
}) {
  const measuredAt = instantLabel(rate.measured_at, preferences.timezone);
  const sample = [
    rate.sample?.requests == null ? null : `${exactNumber(rate.sample.requests)} requests`,
    rate.sample?.input_tokens == null
      ? null
      : `${exactNumber(rate.sample.input_tokens)} input tokens`,
    rate.sample?.output_tokens == null
      ? null
      : `${exactNumber(rate.sample.output_tokens)} output tokens`,
  ].filter((part): part is string => part !== null);
  // An `excludes` array of nothing but blanks renders a term with no value, which reads as
  // "excludes: (nothing)" — a claim the payload never made.
  const excludes = sentenceList(rate.excludes);

  const provenance = [
    rate.scope === null
      ? {
          term: "Scope",
          detail:
            "Not stated by this measurement. Only a marginal scope excludes idle draw, so whether idle is inside these rates is unknown.",
        }
      : {
          term: "Scope",
          detail:
            rate.scope === "marginal"
              ? "Marginal — only the energy a request adds above idle."
              : `${rate.scope} — not marginal, so idle draw is not necessarily outside these rates.`,
        },
    rate.energy_source === null
      ? { term: "Source", detail: "Not stated by this measurement." }
      : {
          term: "Source",
          detail:
            rate.energy_source === "gpu_board_power"
              ? "GPU board power only — the draw reported by the card. CPU, RAM, fans and power-supply losses are not in it."
              : rate.energy_source,
        },
    rate.method === null ? null : { term: "Method", detail: rate.method },
    sample.length === 0 ? null : { term: "Sample", detail: sample.join(" · ") },
    rate.context_tokens === null
      ? null
      : { term: "Context", detail: `${exactNumber(rate.context_tokens)} tokens` },
    rate.significant_figures === null
      ? null
      : {
          term: "Precision",
          detail: `about ${rate.significant_figures} significant figures`,
        },
    measuredAt === null ? null : { term: "Measured at", detail: measuredAt },
    excludes === "" ? null : { term: "Excludes", detail: excludes },
    {
      term: "Cached input",
      detail: rate.cached_input_priced
        ? "Priced by this sample."
        : "Not priced by this sample. Every run defeated the prompt cache, so the input rate is the uncached price.",
    },
  ].filter((entry): entry is { term: string; detail: string } => entry !== null);

  return (
    <details className="mx-auto mt-3 max-w-[55rem] overflow-hidden rounded-[var(--rad-xl)] bg-(--ui-surface)/60">
      <summary className="cursor-pointer px-5 py-3 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.1em] text-(--ui-muted) hover:text-(--ui-fg)">
        How {modelLabel} was measured
      </summary>
      <div className="space-y-3 px-5 pb-5 text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
        <p>
          The telemetry store knows what N tokens cost in total; it cannot know how that total split
          between reading a prompt and writing an answer. Its energy samples carry no request id and
          have a one-minute grain, while most requests are shorter than a minute. So the split is
          measured separately, in a bench run, and read from a config file with its provenance
          attached.
        </p>
        {paragraphs(rate.notes).map((note, index) => (
          <p key={index}>{note}</p>
        ))}
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[8rem_1fr]">
          {provenance.map((entry) => (
            <Fragment key={entry.term}>
              <dt className="text-(--ui-muted)">{entry.term}</dt>
              <dd className="text-(--ui-fg)/85">{entry.detail}</dd>
            </Fragment>
          ))}
        </dl>
        <dl className="grid gap-x-4 gap-y-1.5 border-t border-(--ui-border)/40 pt-3 sm:grid-cols-[8rem_1fr]">
          {glossary(rate).map((entry) => (
            <Fragment key={entry.term}>
              <dt className="text-(--ui-muted)">{entry.term}</dt>
              <dd className="text-(--ui-fg)/85">{entry.detail}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </details>
  );
}
