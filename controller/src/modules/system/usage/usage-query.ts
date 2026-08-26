import {
  USAGE_PERIODS,
  type UsageFilters,
  type UsagePeriod,
  type UsageStats,
} from "@local-studio/contracts/usage";
import { Effect } from "effect";
import { badRequest } from "../../../core/errors";

export interface ParsedUsageQuery {
  period: UsagePeriod;
  model: string;
  timezone: string;
}

const isUsagePeriod = (value: string): value is UsagePeriod =>
  USAGE_PERIODS.includes(value as UsagePeriod);

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export const parseUsageQuery = (raw: {
  period: string | undefined;
  model: string | undefined;
  tz: string | undefined;
}): Effect.Effect<ParsedUsageQuery, ReturnType<typeof badRequest>> => {
  const period = raw.period ?? "all";
  const model = raw.model?.trim() || "all";
  const timezone = raw.tz?.trim() || "UTC";
  if (!isUsagePeriod(period)) return Effect.fail(badRequest("Invalid usage period"));
  if (!isTimeZone(timezone)) return Effect.fail(badRequest("Invalid usage timezone"));
  return Effect.succeed({ period, model, timezone });
};

const filtersFor = (body: UsageStats, query: ParsedUsageQuery): UsageFilters => ({
  period: query.period,
  model: query.model,
  supported_periods: [...USAGE_PERIODS],
  supported_models: [...new Set(body.by_model.map((entry) => entry.model))],
  models: [],
  range: { first_day: null, last_day: null },
  heatmap_range: { first_day: null, last_day: null },
  raw_retention_days: 0,
  energy_sample_interval_s: null,
});

export const withUsageQuery = (body: UsageStats, query: ParsedUsageQuery): UsageStats => ({
  ...body,
  timezone: query.timezone,
  filters: filtersFor(body, query),
});
