"use client";

import { useMemo, useState } from "react";
import { Select } from "@/ui";
import { effectInterval } from "@/lib/effect-timers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { MetricSampleInput } from "./status-section-view";

type MetricSample = {
  at: number;
  gpuAt: number | null;
  metricsAt: number | null;
  performanceAt: number | null;
  generation: number | null;
  prefill: number | null;
  requests: number | null;
  queued: number | null;
  ttft: number | null;
  gpuUtilization: number | null;
  vramPercent: number | null;
  powerWatts: number | null;
  temperatureC: number | null;
};

type MetricPeak = {
  generation: number | null;
  prefill: number | null;
  requests: number | null;
  ttft: number | null;
};

type MetricKey = Exclude<keyof MetricSample, "at" | "gpuAt" | "metricsAt" | "performanceAt">;
type RangeKey = "5m" | "30m" | "session";
type MetricObservations = { gpus: number; metrics: number };
type TrendPreference = { metric: MetricKey; range: RangeKey };

const METRICS: Record<
  MetricKey,
  { label: string; unit: string; digits: number; color: string; peak?: keyof MetricPeak }
> = {
  generation: {
    label: "Decode throughput",
    unit: "tok/s",
    digits: 1,
    color: "text-(--accent)",
    peak: "generation",
  },
  prefill: {
    label: "Prefill throughput",
    unit: "tok/s",
    digits: 1,
    color: "text-(--hl2)",
    peak: "prefill",
  },
  ttft: { label: "Observed TTFT", unit: "ms", digits: 0, color: "text-(--hl3)", peak: "ttft" },
  requests: {
    label: "Active requests",
    unit: "",
    digits: 0,
    color: "text-(--accent)",
    peak: "requests",
  },
  queued: { label: "Queued requests", unit: "", digits: 0, color: "text-(--hl3)" },
  gpuUtilization: { label: "GPU utilization", unit: "%", digits: 0, color: "text-(--hl2)" },
  vramPercent: { label: "VRAM used", unit: "%", digits: 1, color: "text-(--accent)" },
  powerWatts: { label: "GPU board power", unit: "W", digits: 0, color: "text-(--hl3)" },
  temperatureC: { label: "GPU temperature", unit: "°C", digits: 0, color: "text-(--hl2)" },
};

const RANGE_MS: Record<RangeKey, number> = {
  "5m": 5 * 60_000,
  "30m": 30 * 60_000,
  session: Number.POSITIVE_INFINITY,
};

const samplesByKey = new Map<string, MetricSample[]>();
const MAX_SAMPLE_SERIES = 12;
const DEFAULT_PREFERENCE: TrendPreference = { metric: "gpuUtilization", range: "5m" };

function scopedSampleKey(controllerKey: string, key: string): string {
  return `${controllerKey || "default"}::${key}`;
}

export function useMetricSamples(
  input: MetricSampleInput,
  observations: MetricObservations,
  controllerKey: string,
) {
  const scopedKey = scopedSampleKey(controllerKey, input.key);
  const observedAt = Math.max(observations.gpus, observations.metrics);
  const [sampleState, setSampleState] = useState(() => ({
    key: scopedKey,
    samples: samplesByKey.get(scopedKey) ?? [],
  }));
  const peaks: MetricPeak = {
    generation: measured(input.generationPeak),
    prefill: measured(input.prefillPeak),
    requests: measured(input.requestPeak),
    ttft: measured(input.ttftPeak),
  };

  useMountSubscription(() => {
    const current = samplesByKey.get(scopedKey) ?? [];
    if (!input.active || observedAt <= 0) {
      setSampleState({ key: scopedKey, samples: [] });
      return;
    }
    const next: MetricSample = {
      at: observedAt,
      gpuAt: observations.gpus > 0 ? observations.gpus : null,
      metricsAt: observations.metrics > 0 ? observations.metrics : null,
      performanceAt: input.performanceObservedAt > 0 ? input.performanceObservedAt : null,
      generation: measured(input.generation),
      prefill: measured(input.prefill),
      requests: measured(input.requests),
      queued: measured(input.queued),
      ttft: measured(input.ttft),
      gpuUtilization: measured(input.gpuUtilization),
      vramPercent: measured(input.vramPercent),
      powerWatts: measured(input.powerWatts),
      temperatureC: measured(input.temperatureC),
    };
    const previous = current.at(-1);
    if (
      !previous ||
      next.at - previous.at >= 4_000 ||
      next.gpuAt !== previous.gpuAt ||
      next.metricsAt !== previous.metricsAt ||
      next.performanceAt !== previous.performanceAt
    ) {
      const nextSamples = [...current, next].slice(-21_600);
      samplesByKey.delete(scopedKey);
      samplesByKey.set(scopedKey, nextSamples);
      while (samplesByKey.size > MAX_SAMPLE_SERIES) {
        const oldestKey = samplesByKey.keys().next().value;
        if (typeof oldestKey !== "string") break;
        samplesByKey.delete(oldestKey);
      }
      setSampleState({ key: scopedKey, samples: nextSamples });
      return;
    }
    setSampleState({ key: scopedKey, samples: current });
  }, [
    scopedKey,
    input.active,
    observedAt,
    observations.gpus,
    observations.metrics,
    input.generation,
    input.prefill,
    input.requests,
    input.queued,
    input.ttft,
    input.gpuUtilization,
    input.vramPercent,
    input.powerWatts,
    input.temperatureC,
    input.performanceObservedAt,
  ]);

  return {
    samples: input.active && sampleState.key === scopedKey ? sampleState.samples : [],
    peaks,
  };
}

export function MetricTrends({
  controllerKey,
  samples,
  peaks,
}: {
  controllerKey: string;
  samples: MetricSample[];
  peaks: MetricPeak;
}) {
  const [preference, setPreference] = useState(() => readTrendPreference(controllerKey));
  const { metric, range } = preference;
  const [now, setNow] = useState(Date.now);
  useMountSubscription(() => effectInterval(() => setNow(Date.now()), 5_000).cancel, []);
  const metricSamples = samplesForMetric(samples, metric);
  const visible = metricSamples.filter((sample) => now - sample.at <= RANGE_MS[range]);
  const definition = METRICS[metric];
  const values = visible.map((sample) => sample[metric]);
  const availableCount = values.filter((value) => value !== null).length;
  const current = [...values].reverse().find((value) => value !== null) ?? null;
  const peak = definition.peak ? peaks[definition.peak] : null;
  const lastSampleAt = metricSamples.at(-1)?.at ?? 0;
  const stale = lastSampleAt > 0 && now - lastSampleAt > 15_000;
  const performanceMetric = isPerformanceMetric(metric);
  const status = performanceMetric
    ? lastSampleAt > 0
      ? `last completed ${formatAge(lastSampleAt, now)}`
      : "no completed request"
    : stale
      ? "Telemetry paused"
      : `${availableCount} samples`;

  const updatePreference = (next: Partial<TrendPreference>) => {
    const updated = { ...preference, ...next };
    setPreference(updated);
    writeTrendPreference(controllerKey, updated);
  };

  return (
    <div className="mt-4 border-t border-(--separator) pt-3 sm:mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={metric}
          onChange={(event) => updatePreference({ metric: event.target.value as MetricKey })}
          options={Object.entries(METRICS).map(([value, item]) => ({ value, label: item.label }))}
          aria-label="Default telemetry graph for this controller"
          className="h-7 w-auto text-[length:var(--fs-xs)]"
        />
        <div className="flex rounded-lg border border-(--separator) p-0.5">
          {(["5m", "30m", "session"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => updatePreference({ range: value })}
              className={`rounded-md px-2 py-1 text-[length:var(--fs-xs)] ${range === value ? "bg-(--active) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
            >
              {value === "session" ? "Session" : value}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[length:var(--fs-xs)] text-(--dim)">
          {status} · this app session
        </span>
      </div>

      {availableCount < 2 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-(--separator) text-[length:var(--fs-sm)] text-(--dim)">
          {performanceMetric
            ? availableCount === 1
              ? "One completed request is available; another will draw the trend."
              : "No completed request measurement is available yet."
            : `This source is not reporting ${definition.label.toLowerCase()} yet.`}
        </div>
      ) : (
        <div className="rounded-lg border border-(--separator) px-3 py-2.5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div>
              <span className="text-[length:var(--fs-sm)] font-medium text-(--hl2)">
                {definition.label}
              </span>
              <span className="ml-2 font-mono text-[length:var(--fs-sm)] text-(--fg)">
                {formatMetric(current, definition.digits, definition.unit)}
              </span>
            </div>
            {peak !== null ? (
              <span className="text-[length:var(--fs-xs)] text-(--dim)">
                session peak {formatMetric(peak, definition.digits, definition.unit)}
              </span>
            ) : null}
          </div>
          <div className="h-24 sm:h-32">
            <Sparkline
              samples={visible.map((sample) => ({ at: sample.at, value: sample[metric] }))}
              rangeStart={range === "session" ? (visible[0]?.at ?? now) : now - RANGE_MS[range]}
              rangeEnd={now}
              className={definition.color}
              overlay={peak}
            />
          </div>
        </div>
      )}

      {metric === "powerWatts" ? (
        <p className="mt-2 text-[length:var(--fs-xs)] text-(--dim)">
          Measured GPU board power. Whole-PC power remains unavailable until a wall meter or UPS
          source is connected.
        </p>
      ) : null}
    </div>
  );
}

function samplesForMetric(samples: MetricSample[], metric: MetricKey): MetricSample[] {
  const observedAt = isPerformanceMetric(metric)
    ? "performanceAt"
    : isGpuMetric(metric)
      ? "gpuAt"
      : "metricsAt";
  const byObservation = new Map<number, MetricSample>();
  for (const sample of samples) {
    const at = sample[observedAt];
    if (at === null) continue;
    byObservation.set(at, { ...sample, at });
  }
  return [...byObservation.values()];
}

function isPerformanceMetric(metric: MetricKey): boolean {
  return metric === "generation" || metric === "prefill" || metric === "ttft";
}

function isGpuMetric(metric: MetricKey): boolean {
  return (
    metric === "gpuUtilization" ||
    metric === "vramPercent" ||
    metric === "powerWatts" ||
    metric === "temperatureC"
  );
}

function preferenceKey(controllerKey: string): string {
  return `local-studio-status-trend:${controllerKey || "default"}`;
}

function readTrendPreference(controllerKey: string): TrendPreference {
  if (typeof window === "undefined") return DEFAULT_PREFERENCE;
  try {
    const value = JSON.parse(
      localStorage.getItem(preferenceKey(controllerKey)) ?? "null",
    ) as unknown;
    if (!value || typeof value !== "object") return DEFAULT_PREFERENCE;
    const metric = (value as { metric?: unknown }).metric;
    const range = (value as { range?: unknown }).range;
    return {
      metric:
        typeof metric === "string" && metric in METRICS ? (metric as MetricKey) : "gpuUtilization",
      range: range === "30m" || range === "session" ? range : "5m",
    };
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function writeTrendPreference(controllerKey: string, preference: TrendPreference): void {
  try {
    localStorage.setItem(preferenceKey(controllerKey), JSON.stringify(preference));
  } catch {}
}

function formatAge(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Sparkline({
  samples,
  rangeStart,
  rangeEnd,
  className,
  overlay,
}: {
  samples: Array<{ at: number; value: number | null }>;
  rangeStart: number;
  rangeEnd: number;
  className: string;
  overlay: number | null;
}) {
  const view = useMemo(() => {
    const finite = samples
      .map((sample) => sample.value)
      .filter((value): value is number => value !== null);
    const max = Math.max(1, ...finite, overlay ?? 0);
    return {
      segments: toPolylineSegments(samples, max, rangeStart, rangeEnd),
      overlayY: overlay !== null ? yForValue(overlay, max) : null,
    };
  }, [overlay, rangeEnd, rangeStart, samples]);

  return (
    <svg
      className="h-full w-full overflow-visible text-(--border)"
      viewBox="0 0 320 96"
      preserveAspectRatio="none"
      role="img"
      aria-label="Timestamped telemetry trend"
    >
      <path
        d="M0 16H320 M0 48H320 M0 80H320"
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0 95.5H320"
        stroke="currentColor"
        strokeOpacity="0.75"
        strokeWidth="0.7"
        vectorEffect="non-scaling-stroke"
      />
      {view.overlayY !== null ? (
        <path
          d={`M0 ${view.overlayY.toFixed(1)}H320`}
          fill="none"
          className="text-(--dim)/45"
          stroke="currentColor"
          strokeDasharray="4 5"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {view.segments.map((points, index) => (
        <polyline
          key={index}
          points={points}
          fill="none"
          className={className}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function toPolylineSegments(
  samples: Array<{ at: number; value: number | null }>,
  max: number,
  rangeStart: number,
  rangeEnd: number,
): string[] {
  const duration = Math.max(1, rangeEnd - rangeStart);
  const segments: string[][] = [];
  let segment: string[] = [];
  samples.forEach(({ at, value }) => {
    if (value === null) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
      return;
    }
    const x = Math.min(320, Math.max(0, ((at - rangeStart) / duration) * 320));
    segment.push(`${x.toFixed(1)},${yForValue(value, max).toFixed(1)}`);
  });
  if (segment.length > 1) segments.push(segment);
  return segments.map((points) => points.join(" "));
}

function yForValue(value: number, max: number): number {
  return 94 - (Math.max(0, value) / max) * 92;
}

function measured(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatMetric(value: number | null, digits: number, unit: string): string {
  if (value === null) return "—";
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}
