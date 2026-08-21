import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Relative on purpose: bun resolves no "@/" alias from this package.
import { normalizeUsageStats } from "../../../frontend/src/features/usage/normalize-usage-stats";

/**
 * THE DEFECT THIS PINS.
 *
 * There are two energy figures and only one of them can be computed from telemetry. The
 * store knows what N tokens cost in TOTAL — it has the watts and it has the counts. It
 * cannot know how that total splits between reading a prompt and writing an answer: its
 * energy samples carry no request id and have a 60-second grain, while most requests are
 * shorter than a minute.
 *
 * The controller used to publish the split anyway, in metrics-collector.ts:
 *
 *     kwh_per_million_input  = lifetime_energy / lifetime_prompt_tokens
 *     kwh_per_million_output = lifetime_energy / lifetime_completion_tokens
 *
 * The same energy, divided twice. Each field claimed 100% of it. Quote one alone and that
 * side is charged for the other side's watts; quote both and the electricity is counted
 * twice. The measured split on this hardware is 20.4:1, so it was wrong by an order of
 * magnitude in both directions at once.
 *
 * The real rates are measured in a bench run and arrive as `energy_rates`. These tests
 * defend the properties that keep them honest on the way to the screen.
 */

const MEASURED = {
  model: "qwen-daily",
  aliases: ["qwen-daily", "qwen-uncensored"],
  wh_per_1m_input: 58.135,
  wh_per_1m_output: 1183.229,
  idle_watts: 122.4,
  scope: "marginal",
  energy_source: "gpu_board_power",
  significant_figures: 2,
  measured_at: "2026-08-21T01:37:10-0300",
  measured_on_alias: "qwen-daily",
  context_tokens: 176128,
  method: "least squares",
  sample: { requests: 6, input_tokens: 89079, output_tokens: 5729 },
  excludes: ["idle draw"],
  cached_input_priced: false,
  notes: ["two significant figures"],
};

const withRates = (rates: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalizeUsageStats({ energy_rates: rates } as any).energy_rates;

describe("measured energy rates reach the client intact", () => {
  test("a measured model keeps every field a reader needs to check it", () => {
    const rates = withRates({
      by_physical_model: [MEASURED],
      unmeasured_physical_models: [],
      measured: true,
    });
    expect(rates?.measured).toBe(true);
    const rate = rates!.by_physical_model[0];
    expect(rate.wh_per_1m_input).toBe(58.135);
    expect(rate.wh_per_1m_output).toBe(1183.229);
    // The provenance is the difference between a number and a claim.
    expect(rate.scope).toBe("marginal");
    expect(rate.energy_source).toBe("gpu_board_power");
    expect(rate.idle_watts).toBe(122.4);
    expect(rate.excludes).toEqual(["idle draw"]);
    expect(rate.sample).toEqual({ requests: 6, input_tokens: 89079, output_tokens: 5729 });
    expect(rate.significant_figures).toBe(2);
    expect(rate.context_tokens).toBe(176128);
  });

  test("both aliases of one physical model are named, because both share the rate", () => {
    const rates = withRates({ by_physical_model: [MEASURED], measured: true });
    expect(rates!.by_physical_model[0].aliases).toEqual(["qwen-daily", "qwen-uncensored"]);
  });

  test("an unmeasured model is listed by name, never zeroed", () => {
    const rates = withRates({
      by_physical_model: [MEASURED],
      unmeasured_physical_models: ["ornith-turbo", "gemma-write"],
      measured: true,
    });
    expect(rates?.unmeasured_physical_models).toEqual(["gemma-write", "ornith-turbo"]);
    expect(rates?.by_physical_model.map((r) => r.model)).toEqual(["qwen-daily"]);
  });

  test("half a measurement is not a measurement — and does not vanish either", () => {
    for (const partial of [
      { ...MEASURED, wh_per_1m_output: null },
      { ...MEASURED, wh_per_1m_input: undefined },
      { ...MEASURED, wh_per_1m_input: "58.135", wh_per_1m_output: "not a number" },
    ]) {
      const rates = withRates({
        by_physical_model: [partial],
        unmeasured_physical_models: [],
        measured: true,
      });
      expect(rates?.by_physical_model).toEqual([]);
      // Dropped from the rates, but still a model with no usable price — so it is named.
      expect(rates?.unmeasured_physical_models).toEqual(["qwen-daily"]);
      expect(rates?.measured).toBe(false);
    }
  });

  test("cached input is treated as unpriced unless the backend says otherwise", () => {
    const { cached_input_priced: absent } = withRates({
      by_physical_model: [{ ...MEASURED, cached_input_priced: undefined }],
    })!.by_physical_model[0];
    expect(absent).toBe(false);

    const { cached_input_priced: stated } = withRates({
      by_physical_model: [{ ...MEASURED, cached_input_priced: true }],
    })!.by_physical_model[0];
    expect(stated).toBe(true);
  });

  test("no rates at all is undefined, not an empty measurement", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeUsageStats({} as any).energy_rates).toBeUndefined();
    expect(withRates({ by_physical_model: [], unmeasured_physical_models: [], measured: false })
      ?.measured).toBe(false);
  });
});

describe("the field that divided one energy twice is gone", () => {
  const source = (relative: string) =>
    readFileSync(join(import.meta.dir, "../../..", relative), "utf8");

  test("metrics-collector no longer derives a per-side rate from lifetime totals", () => {
    const collector = source("controller/src/modules/system/metrics-collector.ts");
    expect(collector).not.toContain("kwh_per_million_input");
    expect(collector).not.toContain("kwh_per_million_output");
  });

  test("and the contract no longer offers the fields to anyone", () => {
    const contract = source("controller/contracts/observability.ts");
    // Only in the comment that records why they left.
    for (const line of contract.split("\n")) {
      if (line.includes("kwh_per_million_input") || line.includes("kwh_per_million_output")) {
        expect(line.trimStart().startsWith("//")).toBe(true);
      }
    }
  });
});
