import type {
  UsageContextBucket,
  UsageEfficiency,
  UsageEfficiencyRatios,
  UsageEnergy,
  UsageEnergyRates,
  UsageFilterModel,
  UsageFilters,
  UsagePeriod,
  UsageSpeculative,
  UsageStats,
  UsageTokens,
} from "@/lib/types";
import { USAGE_PERIODS } from "@local-studio/contracts/usage";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function array(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeControllerUsage(value: unknown): UsageStats["controller"] {
  const controller = record(value);
  if (Object.keys(controller).length === 0) return undefined;
  const totals = record(controller.totals);
  const latency = record(controller.latency);
  const recent = record(controller.recent_activity);
  const functionCalls = record(controller.function_calls);
  const functionTotals = record(functionCalls.totals);
  const functionLatency = record(functionCalls.latency);

  return {
    totals: {
      total_requests: num(totals.total_requests),
      successful_requests: num(totals.successful_requests),
      failed_requests: num(totals.failed_requests),
      success_rate: num(totals.success_rate),
    },
    latency: {
      avg_ms: nullableNum(latency.avg_ms),
      max_ms: nullableNum(latency.max_ms),
    },
    recent_activity: {
      last_hour_requests: num(recent.last_hour_requests),
      last_24h_requests: num(recent.last_24h_requests),
      last_24h_failed_requests: num(recent.last_24h_failed_requests),
    },
    by_path: array(controller.by_path).map((path) => ({
      method: text(path.method, ""),
      path: text(path.path, ""),
      requests: num(path.requests),
      successful: num(path.successful),
      failed: num(path.failed),
      success_rate: num(path.success_rate),
      avg_duration_ms: nullableNum(path.avg_duration_ms),
      max_duration_ms: nullableNum(path.max_duration_ms),
    })),
    by_status: array(controller.by_status).map((status) => ({
      status: num(status.status),
      requests: num(status.requests),
    })),
    recent_errors: array(controller.recent_errors).map((error) => ({
      method: text(error.method, ""),
      path: text(error.path, ""),
      status: num(error.status),
      error_class: text(error.error_class, "") || null,
      error_message: text(error.error_message, "") || null,
      created_at: text(error.created_at, ""),
    })),
    function_calls:
      Object.keys(functionCalls).length === 0
        ? undefined
        : {
            totals: {
              total_calls: num(functionTotals.total_calls),
              successful_calls: num(functionTotals.successful_calls),
              failed_calls: num(functionTotals.failed_calls),
              success_rate: num(functionTotals.success_rate),
            },
            latency: {
              avg_ms: nullableNum(functionLatency.avg_ms),
              max_ms: nullableNum(functionLatency.max_ms),
            },
            by_function: array(functionCalls.by_function).map((entry) => ({
              function_name: text(entry.function_name, ""),
              calls: num(entry.calls),
              successful: num(entry.successful),
              failed: num(entry.failed),
              success_rate: num(entry.success_rate),
              avg_duration_ms: nullableNum(entry.avg_duration_ms),
              max_duration_ms: nullableNum(entry.max_duration_ms),
            })),
            recent_errors: array(functionCalls.recent_errors).map((error) => ({
              function_name: text(error.function_name, ""),
              error_class: text(error.error_class, "") || null,
              error_message: text(error.error_message, "") || null,
              created_at: text(error.created_at, ""),
            })),
          },
  };
}

function coverageStatus(value: unknown): "complete" | "partial" | "no-data" {
  return value === "complete" || value === "partial" ? value : "no-data";
}

function period(value: unknown): UsagePeriod {
  return USAGE_PERIODS.includes(value as UsagePeriod) ? (value as UsagePeriod) : "all";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeFilterModels(value: unknown): UsageFilterModel[] {
  return array(value).flatMap((entry) => {
    const id = text(entry.id, "");
    const label = text(entry.label, "").trim();
    if (id === "" || label === "") return [];
    const aliases = strings(entry.aliases);
    return [
      {
        id,
        label,
        aliases: aliases.includes(id) ? aliases : [id, ...aliases],
        // Retirement is asserted only when the host says so. A host that never learned
        // about `served` leaves it undefined, and every model would read as retired.
        served: entry.served !== false,
      },
    ];
  });
}

function normalizeFilters(value: unknown): UsageFilters | undefined {
  const filters = record(value);
  if (Object.keys(filters).length === 0) return undefined;
  const range = record(filters.range);
  const heatmap = record(filters.heatmap_range);
  const periods = strings(filters.supported_periods).filter((item): item is UsagePeriod =>
    USAGE_PERIODS.includes(item as UsagePeriod),
  );
  return {
    period: period(filters.period),
    model: text(filters.model, "all"),
    supported_periods: periods.length > 0 ? periods : [...USAGE_PERIODS],
    supported_models: strings(filters.supported_models),
    models: normalizeFilterModels(filters.models),
    range: { first_day: nullableText(range.first_day), last_day: nullableText(range.last_day) },
    heatmap_range: {
      first_day: nullableText(heatmap.first_day),
      last_day: nullableText(heatmap.last_day),
    },
    raw_retention_days: num(filters.raw_retention_days),
    energy_sample_interval_s: nullableNum(filters.energy_sample_interval_s),
  };
}

function normalizeSpeculative(value: unknown): UsageSpeculative {
  const spec = record(value);
  const drafted = nullableNum(spec.drafted_tokens);
  const accepted = nullableNum(spec.accepted_tokens);
  return {
    available: spec.available === true && drafted !== null,
    drafted_tokens: drafted,
    accepted_tokens: accepted,
    acceptance_rate: nullableNum(spec.acceptance_rate),
    speculative_requests: nullableNum(spec.speculative_requests),
    measured_requests: nullableNum(spec.measured_requests),
  };
}

function normalizeContextBuckets(value: unknown): UsageContextBucket[] {
  return array(value)
    .map((bucket) => ({
      bucket: text(bucket.bucket, ""),
      label: text(bucket.label, ""),
      lower_tokens: num(bucket.lower_tokens),
      upper_tokens: nullableNum(bucket.upper_tokens),
      requests: num(bucket.requests),
      generated_tokens: num(bucket.generated_tokens),
      decode_tps: nullableNum(bucket.decode_tps),
    }))
    .filter((bucket) => bucket.bucket !== "" && bucket.requests > 0);
}

function normalizeTokens(value: unknown): UsageTokens | undefined {
  const tokens = record(value);
  if (Object.keys(tokens).length === 0) return undefined;
  const totals = record(tokens.totals);
  const performance = record(tokens.performance);
  const context = record(tokens.context);
  return {
    totals: {
      processed_tokens: num(totals.processed_tokens),
      fresh_prompt_tokens: num(totals.fresh_prompt_tokens),
      generated_tokens: num(totals.generated_tokens),
      cached_input_tokens: num(totals.cached_input_tokens),
      logical_prompt_tokens: num(totals.logical_prompt_tokens),
      logical_tokens: num(totals.logical_tokens),
      cache_hit_rate: num(totals.cache_hit_rate),
      requests: num(totals.requests),
      successful_requests: num(totals.successful_requests),
      failed_requests: num(totals.failed_requests),
      success_rate: num(totals.success_rate),
      processed_per_request: nullableNum(totals.processed_per_request),
    },
    performance: {
      decode_tps: nullableNum(performance.decode_tps),
      prefill_tps: nullableNum(performance.prefill_tps),
      decode_tps_p50: nullableNum(performance.decode_tps_p50),
      decode_tps_p95: nullableNum(performance.decode_tps_p95),
      prefill_tps_p50: nullableNum(performance.prefill_tps_p50),
      prefill_tps_p95: nullableNum(performance.prefill_tps_p95),
      avg_ttft_ms: nullableNum(performance.avg_ttft_ms),
      p95_ttft_ms: nullableNum(performance.p95_ttft_ms),
      avg_latency_ms: nullableNum(performance.avg_latency_ms),
      p95_latency_ms: nullableNum(performance.p95_latency_ms),
      speculative: normalizeSpeculative(performance.speculative),
      by_context: normalizeContextBuckets(performance.by_context),
    },
    context: {
      avg_tokens: nullableNum(context.avg_tokens),
      p95_tokens: nullableNum(context.p95_tokens),
      peak_tokens: nullableNum(context.peak_tokens),
      limit_tokens: nullableNum(context.limit_tokens),
      peak_pct: nullableNum(context.peak_pct),
    },
    daily: array(tokens.daily).map((day) => ({
      date: text(day.date, ""),
      requests: num(day.requests),
      processed_tokens: num(day.processed_tokens),
      fresh_prompt_tokens: num(day.fresh_prompt_tokens),
      generated_tokens: num(day.generated_tokens),
      cached_input_tokens: num(day.cached_input_tokens),
      logical_tokens: num(day.logical_tokens),
    })),
    by_model: array(tokens.by_model).map((model) => ({
      model: text(model.model, "unknown"),
      requests: num(model.requests),
      successful: num(model.successful),
      success_rate: num(model.success_rate),
      processed_tokens: num(model.processed_tokens),
      logical_tokens: num(model.logical_tokens),
      fresh_prompt_tokens: num(model.fresh_prompt_tokens),
      cached_input_tokens: num(model.cached_input_tokens),
      generated_tokens: num(model.generated_tokens),
      logical_prompt_tokens: num(model.logical_prompt_tokens),
      decode_tps: nullableNum(model.decode_tps),
      prefill_tps: nullableNum(model.prefill_tps),
    })),
  };
}

function normalizeEnergy(value: unknown): UsageEnergy | undefined {
  const energy = record(value);
  if (Object.keys(energy).length === 0) return undefined;
  const totals = record(energy.totals);
  const attribution = record(energy.attribution_model);
  return {
    available: energy.available === true,
    attribution: {
      inference_kwh: nullableNum(totals.inference_kwh),
      other_gpu_work_kwh: nullableNum(totals.other_gpu_work_kwh),
      idle_kwh: nullableNum(totals.idle_kwh),
      models_without_floor: strings(attribution.models_without_floor),
      inference_is_lower_bound: totals.inference_is_lower_bound === true,
    },
    totals: {
      energy_kwh: nullableNum(totals.energy_kwh),
      inference_kwh: nullableNum(totals.inference_kwh),
      measured_seconds: num(totals.measured_seconds),
      expected_seconds: num(totals.expected_seconds),
      coverage_pct: nullableNum(totals.coverage_pct),
      avg_power_w: nullableNum(totals.avg_power_w),
      peak_power_w: nullableNum(totals.peak_power_w),
      samples: num(totals.samples),
      avg_temp_c: nullableNum(totals.avg_temp_c),
      peak_temp_c: nullableNum(totals.peak_temp_c),
      avg_utilization_pct: nullableNum(totals.avg_utilization_pct),
      status: coverageStatus(totals.status),
    },
    daily: array(energy.daily).map((day) => ({
      date: text(day.date, ""),
      energy_kwh: nullableNum(day.energy_kwh),
      inference_kwh: nullableNum(day.inference_kwh),
      measured_seconds: num(day.measured_seconds),
      expected_seconds: num(day.expected_seconds),
      coverage_pct: nullableNum(day.coverage_pct),
      avg_power_w: nullableNum(day.avg_power_w),
      peak_power_w: nullableNum(day.peak_power_w),
      status: coverageStatus(day.status),
    })),
    by_model: array(energy.by_model).map((model) => ({
      model: nullableText(model.model),
      energy_kwh: num(model.energy_kwh),
      inference_kwh: nullableNum(model.inference_kwh),
      other_gpu_work_kwh: nullableNum(model.other_gpu_work_kwh),
      measured_seconds: num(model.measured_seconds),
      avg_power_w: nullableNum(model.avg_power_w),
      peak_power_w: nullableNum(model.peak_power_w),
    })),
  };
}

/**
 * Both denominators off one row, and no arithmetic here.
 *
 * A missing `*_inference` stays null rather than falling back to the gross figure: the two
 * differ by about 3x on the owner's own rig, and silently reading one under the other's
 * label is the exact defect AI mode exists to fix.
 */
function ratios(row: UnknownRecord): UsageEfficiencyRatios {
  return {
    energy_kwh: nullableNum(row.energy_kwh),
    inference_kwh: nullableNum(row.inference_kwh),
    tokens_per_kwh: nullableNum(row.tokens_per_kwh),
    kwh_per_million_processed: nullableNum(row.kwh_per_million_processed),
    tokens_per_kwh_inference: nullableNum(row.tokens_per_kwh_inference),
    kwh_per_million_processed_inference: nullableNum(row.kwh_per_million_processed_inference),
  };
}

function normalizeEfficiency(value: unknown): UsageEfficiency | undefined {
  const efficiency = record(value);
  if (Object.keys(efficiency).length === 0) return undefined;
  const totals = record(efficiency.totals);
  return {
    totals: {
      ...ratios(totals),
      processed_tokens: num(totals.processed_tokens),
      coverage_pct: nullableNum(totals.coverage_pct),
      partial: totals.partial === true,
      partial_inference: totals.partial_inference === true,
      inference_is_lower_bound: totals.inference_is_lower_bound === true,
    },
    daily: array(efficiency.daily).map((day) => ({
      ...ratios(day),
      date: text(day.date, ""),
      processed_tokens: num(day.processed_tokens),
      coverage_pct: nullableNum(day.coverage_pct),
    })),
    by_model: array(efficiency.by_model).map((model) => ({
      model: text(model.model, "unknown"),
      processed_tokens: num(model.processed_tokens),
      energy_kwh: nullableNum(model.energy_kwh),
      tokens_per_kwh: nullableNum(model.tokens_per_kwh),
      kwh_per_million_processed: nullableNum(model.kwh_per_million_processed),
    })),
    by_physical_model: array(efficiency.by_physical_model).map((model) => ({
      ...ratios(model),
      model: text(model.model, "unknown"),
      aliases: strings(model.aliases),
      processed_tokens: num(model.processed_tokens),
      idle_floor_w: nullableNum(model.idle_floor_w),
      idle_floor_source: nullableText(model.idle_floor_source),
    })),
  };
}

function normalizeEnergyRates(value: unknown): UsageEnergyRates | undefined {
  const rates = record(value);
  if (Object.keys(rates).length === 0) return undefined;

  // A rate is only a rate if BOTH sides are finite and POSITIVE. Half a measurement is not
  // a measurement, and a model that arrives half-measured belongs with the unmeasured ones
  // rather than on screen beside a number the reader would assume was checked. Zero or
  // negative is a degenerate fit, not a free forward pass: prefilling a million tokens
  // costs energy, and letting one through promotes it to a headline money figure whose
  // hero bar is clamped to 2% so it still looks measured.
  const measured = array(rates.by_physical_model).flatMap((entry) => {
    const input = nullableNum(entry.wh_per_1m_input);
    const output = nullableNum(entry.wh_per_1m_output);
    if (input === null || output === null || input <= 0 || output <= 0) return [];
    return [
      {
        model: text(entry.model, "unknown"),
        aliases: strings(entry.aliases),
        wh_per_1m_input: input,
        wh_per_1m_output: output,
        idle_watts: nullableNum(entry.idle_watts),
        scope: nullableText(entry.scope),
        energy_source: nullableText(entry.energy_source),
        significant_figures: nullableNum(entry.significant_figures),
        measured_at: nullableText(entry.measured_at),
        measured_on_alias: nullableText(entry.measured_on_alias),
        context_tokens: nullableNum(entry.context_tokens),
        method: nullableText(entry.method),
        sample:
          Object.keys(record(entry.sample)).length === 0
            ? null
            : {
                requests: nullableNum(record(entry.sample).requests),
                input_tokens: nullableNum(record(entry.sample).input_tokens),
                output_tokens: nullableNum(record(entry.sample).output_tokens),
              },
        excludes: strings(entry.excludes),
        // Defaults to "not priced". Assuming a sample priced cached input when it did not
        // say so would understate the input side by an order of magnitude.
        cached_input_priced: entry.cached_input_priced === true,
        notes: strings(entry.notes),
      },
    ];
  });

  // A model dropped for arriving half-measured is still a model with no usable rate, so it
  // joins the unmeasured list rather than vanishing from the payload entirely.
  const droppedHalfMeasured = array(rates.by_physical_model)
    .map((entry) => text(entry.model, "unknown"))
    .filter((model) => !measured.some((rate) => rate.model === model));

  return {
    by_physical_model: measured,
    unmeasured_physical_models: [
      ...new Set([...strings(rates.unmeasured_physical_models), ...droppedHalfMeasured]),
    ].sort(),
    measured: measured.length > 0,
  };
}

export function normalizeUsageStats(input: UsageStats | null | undefined): UsageStats {
  const s = record(input);
  const totals = record(s.totals);
  const latency = record(s.latency);
  const ttft = record(s.ttft);
  const tokensPerRequest = record(s.tokens_per_request);
  const cache = record(s.cache);
  const weekOverWeek = record(s.week_over_week);
  const thisWeek = record(weekOverWeek.this_week);
  const lastWeek = record(weekOverWeek.last_week);
  const changePct = record(weekOverWeek.change_pct);
  const recent = record(s.recent_activity);

  return {
    collection_started_at:
      typeof s.collection_started_at === "string" ? s.collection_started_at : null,
    energy_collection_started_at: nullableText(s.energy_collection_started_at),
    timezone: typeof s.timezone === "string" ? s.timezone : undefined,
    filters: normalizeFilters(s.filters),
    tokens: normalizeTokens(s.tokens),
    energy: normalizeEnergy(s.energy),
    efficiency: normalizeEfficiency(s.efficiency),
    energy_rates: normalizeEnergyRates(s.energy_rates),
    telemetry_enabled: s.telemetry_enabled !== false,
    totals: {
      total_tokens: num(totals.total_tokens),
      prompt_tokens: num(totals.prompt_tokens),
      completion_tokens: num(totals.completion_tokens),
      total_requests: num(totals.total_requests),
      successful_requests: num(totals.successful_requests),
      failed_requests: num(totals.failed_requests),
      success_rate: num(totals.success_rate),
      unique_sessions: num(totals.unique_sessions),
      unique_users: num(totals.unique_users),
    },
    latency: {
      avg_ms: nullableNum(latency.avg_ms),
      p50_ms: nullableNum(latency.p50_ms),
      p95_ms: nullableNum(latency.p95_ms),
      p99_ms: nullableNum(latency.p99_ms),
      min_ms: nullableNum(latency.min_ms),
      max_ms: nullableNum(latency.max_ms),
    },
    ttft: {
      avg_ms: nullableNum(ttft.avg_ms),
      p50_ms: nullableNum(ttft.p50_ms),
      p95_ms: nullableNum(ttft.p95_ms),
      p99_ms: nullableNum(ttft.p99_ms),
    },
    tokens_per_request: {
      avg: num(tokensPerRequest.avg),
      avg_prompt: num(tokensPerRequest.avg_prompt),
      avg_completion: num(tokensPerRequest.avg_completion),
      max: num(tokensPerRequest.max),
      p50: num(tokensPerRequest.p50),
      p95: num(tokensPerRequest.p95),
    },
    cache: {
      hits: num(cache.hits),
      misses: num(cache.misses),
      hit_tokens: num(cache.hit_tokens),
      miss_tokens: num(cache.miss_tokens),
      hit_rate: num(cache.hit_rate),
    },
    week_over_week: {
      this_week: {
        requests: num(thisWeek.requests),
        tokens: num(thisWeek.tokens),
        successful: num(thisWeek.successful),
      },
      last_week: {
        requests: num(lastWeek.requests),
        tokens: num(lastWeek.tokens),
        successful: num(lastWeek.successful),
      },
      change_pct: {
        requests: nullableNum(changePct.requests),
        tokens: nullableNum(changePct.tokens),
      },
    },
    recent_activity: {
      last_hour_requests: num(recent.last_hour_requests),
      last_24h_requests: num(recent.last_24h_requests),
      prev_24h_requests: num(recent.prev_24h_requests),
      last_24h_tokens: num(recent.last_24h_tokens),
      change_24h_pct: nullableNum(recent.change_24h_pct),
    },
    peak_days: array(s.peak_days).map((day) => ({
      date: text(day.date, ""),
      requests: num(day.requests),
      tokens: num(day.tokens),
    })),
    peak_hours: array(s.peak_hours).map((hour) => ({
      hour: num(hour.hour),
      requests: num(hour.requests),
    })),
    by_model: array(s.by_model).map((model, index) => ({
      model: text(model.model, `unknown-${index + 1}`),
      requests: num(model.requests),
      successful: num(model.successful),
      success_rate: num(model.success_rate),
      total_tokens: num(model.total_tokens),
      prompt_tokens: num(model.prompt_tokens),
      completion_tokens: num(model.completion_tokens),
      avg_tokens: num(model.avg_tokens),
      avg_latency_ms: nullableNum(model.avg_latency_ms),
      p50_latency_ms: nullableNum(model.p50_latency_ms),
      avg_ttft_ms: nullableNum(model.avg_ttft_ms),
      tokens_per_sec: nullableNum(model.tokens_per_sec),
      prefill_tps: nullableNum(model.prefill_tps),
      generation_tps: nullableNum(model.generation_tps),
    })),
    daily: array(s.daily).map((day) => ({
      date: text(day.date, ""),
      requests: num(day.requests),
      successful: num(day.successful),
      success_rate: num(day.success_rate),
      total_tokens: num(day.total_tokens),
      prompt_tokens: num(day.prompt_tokens),
      completion_tokens: num(day.completion_tokens),
      avg_latency_ms: num(day.avg_latency_ms),
    })),
    daily_by_model: array(s.daily_by_model).map((day, index) => ({
      date: text(day.date, ""),
      model: text(day.model, `unknown-${index + 1}`),
      requests: num(day.requests),
      successful: num(day.successful),
      success_rate: num(day.success_rate),
      total_tokens: num(day.total_tokens),
      prompt_tokens: num(day.prompt_tokens),
      completion_tokens: num(day.completion_tokens),
    })),
    hourly_pattern: array(s.hourly_pattern).map((hour) => ({
      hour: num(hour.hour),
      requests: num(hour.requests),
      successful: num(hour.successful),
      tokens: num(hour.tokens),
    })),
    controller: normalizeControllerUsage(s.controller),
  };
}
