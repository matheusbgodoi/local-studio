export interface ControllerUsageStats {
  totals: {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number;
  };
  latency: {
    avg_ms: number | null;
    max_ms: number | null;
  };
  recent_activity: {
    last_hour_requests: number;
    last_24h_requests: number;
    last_24h_failed_requests: number;
  };
  by_path: Array<{
    method: string;
    path: string;
    requests: number;
    successful: number;
    failed: number;
    success_rate: number;
    avg_duration_ms: number | null;
    max_duration_ms: number | null;
  }>;
  by_status: Array<{
    status: number;
    requests: number;
  }>;
  recent_errors: Array<{
    method: string;
    path: string;
    status: number;
    error_class: string | null;
    error_message: string | null;
    created_at: string;
  }>;
  function_calls?: {
    totals: {
      total_calls: number;
      successful_calls: number;
      failed_calls: number;
      success_rate: number;
    };
    latency: {
      avg_ms: number | null;
      max_ms: number | null;
    };
    by_function: Array<{
      function_name: string;
      calls: number;
      successful: number;
      failed: number;
      success_rate: number;
      avg_duration_ms: number | null;
      max_duration_ms: number | null;
    }>;
    recent_errors: Array<{
      function_name: string;
      error_class: string | null;
      error_message: string | null;
      created_at: string;
    }>;
  };
}

export interface UsageStats {
  /**
   * When this deployment's telemetry began recording. Local inference accounting
   * starts the day it is switched on: there is no historical traffic to recover,
   * and inventing a backfill would be worse than an honest start date.
   */
  collection_started_at?: string | null;
  /** False when the backend is deliberately not accounting at all. */
  telemetry_enabled?: boolean;
  totals: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number;
    unique_sessions: number;
    unique_users: number;
  };
  latency: {
    avg_ms: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    p99_ms: number | null;
    min_ms: number | null;
    max_ms: number | null;
  };
  ttft: {
    avg_ms: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    p99_ms: number | null;
  };
  tokens_per_request: {
    avg: number;
    avg_prompt: number;
    avg_completion: number;
    max: number;
    p50: number;
    p95: number;
  };
  cache: {
    hits: number;
    misses: number;
    hit_tokens: number;
    miss_tokens: number;
    hit_rate: number;
  };
  week_over_week: {
    this_week: {
      requests: number;
      tokens: number;
      successful: number;
    };
    last_week: {
      requests: number;
      tokens: number;
      successful: number;
    };
    change_pct: {
      requests: number | null;
      tokens: number | null;
    };
  };
  recent_activity: {
    last_hour_requests: number;
    last_24h_requests: number;
    prev_24h_requests: number;
    last_24h_tokens: number;
    change_24h_pct: number | null;
  };
  peak_days: Array<{
    date: string;
    requests: number;
    tokens: number;
  }>;
  peak_hours: Array<{
    hour: number;
    requests: number;
  }>;
  by_model: Array<{
    model: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_tokens: number;
    avg_latency_ms: number | null;
    p50_latency_ms: number | null;
    avg_ttft_ms: number | null;
    tokens_per_sec: number | null;
    prefill_tps: number | null;
    generation_tps: number | null;
  }>;
  daily: Array<{
    date: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_latency_ms: number;
  }>;
  daily_by_model?: Array<{
    date: string;
    model: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  hourly_pattern: Array<{
    hour: number;
    requests: number;
    successful: number;
    tokens: number;
  }>;
  controller?: ControllerUsageStats;
  /**
   * When GPU energy accounting began. Energy has no history before a sampler
   * existed, so days before this are blank rather than zero.
   */
  energy_collection_started_at?: string | null;
  /** IANA zone the backend bucketed calendar days in. */
  timezone?: string;
  filters?: UsageFilters;
  /**
   * Scoped by filters.period and filters.model. The flat blocks above stay
   * lifetime and unfiltered so existing consumers are untouched.
   */
  tokens?: UsageTokens;
  energy?: UsageEnergy;
  efficiency?: UsageEfficiency;
  /** Measured, not derived from anything above. See {@link UsageEnergyRates}. */
  energy_rates?: UsageEnergyRates;
}


/**
 * MEASURED energy rates, per side of the token count, keyed by PHYSICAL model.
 *
 * Nothing else in this payload can produce these, and the backend does not try. The
 * telemetry store knows what N tokens cost in TOTAL — that is `kwh_per_million_processed`
 * above — but it cannot split that total between prefill and decode: its energy samples
 * carry no request id and have a 60-second grain, while most requests are shorter than a
 * minute. So the split is measured in the workload by a bench run and read from a config
 * with its provenance attached.
 *
 * The provenance is not decoration and must reach the reader. `scope: "marginal"` means
 * idle draw is excluded; `energy_source: "gpu_board_power"` means the CPU and the rest of
 * the host are excluded. A cost built from these is a floor, not a bill, and a UI that
 * renders the number without the sentence is quoting a price it cannot honour.
 */
export interface UsageEnergyRate {
  /** The physical model the energy was measured on. */
  model: string;
  /** Every logical alias that runs on it, and therefore shares the rate. */
  aliases: string[];
  wh_per_1m_input: number;
  wh_per_1m_output: number;
  /** Board draw with the model resident and serving nothing. Excluded from the rates. */
  idle_watts: number | null;
  /** "marginal" — above idle. Anything else must be read before the number is trusted. */
  scope: string | null;
  /** "gpu_board_power" — the card only. */
  energy_source: string | null;
  significant_figures: number | null;
  measured_at: string | null;
  measured_on_alias: string | null;
  context_tokens: number | null;
  method: string | null;
  sample: {
    requests: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
  } | null;
  /** What the number does not include. Render it. */
  excludes: string[];
  /** False means cached input was deliberately defeated and is NOT priced by this sample. */
  cached_input_priced: boolean;
  notes: string[];
}

export interface UsageEnergyRates {
  by_physical_model: UsageEnergyRate[];
  /**
   * Named, not merely absent. "We did not measure this" and "this costs nothing" are
   * different statements, and a model with no measurement must never borrow another
   * model's rate or have one derived from the combined figure.
   */
  unmeasured_physical_models: string[];
  measured: boolean;
}

export const USAGE_PERIODS = ["today", "7d", "30d", "365d", "all"] as const;

export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export interface UsageFilters {
  period: UsagePeriod;
  model: string;
  supported_periods: UsagePeriod[];
  /** Union of aliases seen in telemetry and aliases the router serves today. */
  supported_models: string[];
  /** Local days the selection covers. first_day null means all history. */
  range: { first_day: string | null; last_day: string | null };
  /** Local days the daily series spans, independent of the selected period. */
  heatmap_range: { first_day: string | null; last_day: string | null };
  raw_retention_days: number;
  energy_sample_interval_s: number | null;
}

export interface UsageTokens {
  totals: {
    /** Fresh prompt evaluation plus generation. Cached reuse excluded. */
    processed_tokens: number;
    fresh_prompt_tokens: number;
    generated_tokens: number;
    cached_input_tokens: number;
    logical_prompt_tokens: number;
    logical_tokens: number;
    cache_hit_rate: number;
    requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number;
    processed_per_request: number | null;
  };
  /** Null where the backend reported no timing, never zero. */
  performance: {
    decode_tps: number | null;
    prefill_tps: number | null;
    decode_tps_p50: number | null;
    decode_tps_p95: number | null;
    prefill_tps_p50: number | null;
    prefill_tps_p95: number | null;
    avg_ttft_ms: number | null;
    p95_ttft_ms: number | null;
    avg_latency_ms: number | null;
    p95_latency_ms: number | null;
    speculative: UsageSpeculative;
    by_context: UsageContextBucket[];
  };
  context: {
    avg_tokens: number | null;
    p95_tokens: number | null;
    peak_tokens: number | null;
    /** The resident server's own context window at the time of the request. */
    limit_tokens: number | null;
    peak_pct: number | null;
  };
  daily: UsageTokenDay[];
  by_model: UsageTokenModel[];
}

/**
 * Speculative decoding over the selected period, computed by the host.
 *
 * `acceptance_rate` is `accepted_tokens / drafted_tokens` for the whole period,
 * never a mean of per-request rates. It is null — never 0 — when nothing was
 * drafted: a model with no drafter and a drafter whose every token was rejected
 * are different facts and must not render the same way.
 */
export interface UsageSpeculative {
  /** False when the engine never reported speculative timings in this period. */
  available: boolean;
  drafted_tokens: number | null;
  accepted_tokens: number | null;
  acceptance_rate: number | null;
  /** Requests that actually drafted at least one token. */
  speculative_requests: number | null;
  /** Requests the engine reported speculative timings for at all. */
  measured_requests: number | null;
}

/** One context-depth bucket of observed decode throughput. Empty buckets are absent. */
export interface UsageContextBucket {
  bucket: string;
  label: string;
  lower_tokens: number;
  upper_tokens: number | null;
  requests: number;
  generated_tokens: number;
  /** SUM(generated) / SUM(engine decode seconds) inside the bucket. */
  decode_tps: number | null;
}

export interface UsageTokenDay {
  date: string;
  requests: number;
  processed_tokens: number;
  fresh_prompt_tokens: number;
  generated_tokens: number;
  cached_input_tokens: number;
  logical_tokens: number;
}

export interface UsageTokenModel {
  model: string;
  requests: number;
  successful: number;
  success_rate: number;
  processed_tokens: number;
  logical_tokens: number;
  fresh_prompt_tokens: number;
  cached_input_tokens: number;
  generated_tokens: number;
  logical_prompt_tokens: number;
  decode_tps: number | null;
  prefill_tps: number | null;
}

/** GPU board energy only. Never CPU, RAM, PSU loss or the wall. */
export interface UsageEnergy {
  available: boolean;
  totals: {
    energy_kwh: number | null;
    measured_seconds: number;
    expected_seconds: number;
    /** Measured over expected. Null when no collector has ever run. */
    coverage_pct: number | null;
    avg_power_w: number | null;
    peak_power_w: number | null;
    samples: number;
    avg_temp_c: number | null;
    peak_temp_c: number | null;
    avg_utilization_pct: number | null;
    status: UsageCoverageStatus;
  };
  daily: UsageEnergyDay[];
  by_model: UsageEnergyModel[];
}

export type UsageCoverageStatus = "complete" | "partial" | "no-data";

export interface UsageEnergyDay {
  date: string;
  energy_kwh: number | null;
  measured_seconds: number;
  expected_seconds: number;
  coverage_pct: number | null;
  avg_power_w: number | null;
  peak_power_w: number | null;
  status: UsageCoverageStatus;
}

export interface UsageEnergyModel {
  /** Null is measured energy no resident alias could be attributed to. */
  model: string | null;
  energy_kwh: number;
  measured_seconds: number;
  avg_power_w: number | null;
  peak_power_w: number | null;
}

/** Cost is absent by design: the tariff is a client preference. */
export interface UsageEfficiency {
  totals: {
    processed_tokens: number;
    energy_kwh: number | null;
    tokens_per_kwh: number | null;
    kwh_per_million_processed: number | null;
    coverage_pct: number | null;
    /** True when the denominator is only a measured fraction of the period. */
    partial: boolean;
  };
  daily: UsageEfficiencyDay[];
  by_model: UsageEfficiencyModel[];
}

export interface UsageEfficiencyDay {
  date: string;
  processed_tokens: number;
  energy_kwh: number | null;
  tokens_per_kwh: number | null;
  kwh_per_million_processed: number | null;
  coverage_pct: number | null;
}

export interface UsageEfficiencyModel {
  model: string;
  processed_tokens: number;
  energy_kwh: number | null;
  tokens_per_kwh: number | null;
  kwh_per_million_processed: number | null;
}
