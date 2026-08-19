"use client";

import { useState } from "react";
import { dayLabel } from "@/features/usage/usage-formatters";

const DAY_MS = 86_400_000;
const WEEKS = 53;

const LEVEL_CLASSES = [
  "bg-(--ui-surface-2)",
  "bg-[color:var(--color-blue-500)]/20",
  "bg-[color:var(--color-blue-500)]/38",
  "bg-[color:var(--color-blue-500)]/62",
  "bg-[color:var(--color-blue-500)]/90",
];
const NO_DATA_CLASS = "bg-transparent ring-1 ring-inset ring-(--ui-border)";

export interface ActivityCell {
  date: string;
  value: number | null;
  summary: string;
}

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const calendarStart = (end: Date): Date => {
  const currentWeek = new Date(end.getTime() - end.getUTCDay() * DAY_MS);
  return new Date(currentWeek.getTime() - (WEEKS - 1) * 7 * DAY_MS);
};

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

const quantile = (values: number[], fraction: number): number =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;

const thresholds = (values: number[]): number[] => {
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  return [
    quantile(positive, 0.25),
    quantile(positive, 0.5),
    quantile(positive, 0.75),
    quantile(positive, 0.9),
  ];
};

const level = (value: number, limits: number[]): number => {
  if (value <= 0) return 0;
  if (value <= (limits[0] ?? 0)) return 1;
  if (value <= (limits[1] ?? 0)) return 2;
  if (value <= (limits[2] ?? 0)) return 3;
  return 4;
};

const monthLabels = (start: Date): Array<string | null> =>
  Array.from({ length: WEEKS }, (_, week) => {
    const date = new Date(start.getTime() + week * 7 * DAY_MS);
    const previous = new Date(date.getTime() - 7 * DAY_MS);
    if (week > 0 && date.getUTCMonth() === previous.getUTCMonth()) return null;
    return date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  });

const inRange = (date: string, first: string | null, last: string | null): boolean => {
  if (first && date < first) return false;
  if (last && date > last) return false;
  return true;
};

export function ActivityHeatmap({
  cells,
  metricLabel,
  timezone,
  rangeStart = null,
  rangeEnd = null,
}: {
  cells: ActivityCell[];
  metricLabel: string;
  timezone: string;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}) {
  const end = startOfUtcDay(new Date());
  const start = calendarStart(end);
  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  const limits = thresholds(
    cells.map((cell) => cell.value).filter((value): value is number => value !== null),
  );
  const grid = Array.from({ length: WEEKS * 7 }, (_, index) => {
    const key = dateKey(new Date(start.getTime() + index * DAY_MS));
    const cell = byDate.get(key) ?? null;
    return { key, cell, selected: inRange(key, rangeStart, rangeEnd) };
  });
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const active = activeDate ? (byDate.get(activeDate) ?? null) : null;

  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[47rem]">
        <div className="mb-2 grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[3px]">
          {monthLabels(start).map((label, index) => (
            <span key={index} className="text-[length:var(--fs-2xs)] text-(--ui-muted)">
              {label}
            </span>
          ))}
        </div>
        <div
          className="grid grid-flow-col grid-cols-[repeat(53,minmax(0,1fr))] grid-rows-7 gap-[3px]"
          aria-label={`Daily ${metricLabel} for the past year`}
        >
          {grid.map(({ key, cell, selected }) => (
            <button
              key={key}
              type="button"
              onFocus={() => setActiveDate(key)}
              onMouseEnter={() => setActiveDate(key)}
              aria-label={
                cell
                  ? `${dayLabel(key, timezone)}: ${cell.summary}`
                  : `${dayLabel(key, timezone)}: no data`
              }
              className={`aspect-square min-h-2.5 rounded-[2px] outline-none ring-(--link) transition-[transform,box-shadow,opacity] hover:scale-125 hover:ring-1 focus-visible:scale-125 focus-visible:ring-2 ${
                cell === null || cell.value === null
                  ? NO_DATA_CLASS
                  : LEVEL_CLASSES[level(cell.value, limits)]
              } ${selected ? "" : "opacity-40"}`}
            />
          ))}
        </div>
        <div className="mt-3 flex min-h-5 items-center justify-between gap-5 text-[length:var(--fs-2xs)] text-(--ui-muted)">
          <span className="tabular-nums text-(--ui-fg)/85">
            {activeDate
              ? `${dayLabel(activeDate, timezone)} · ${active ? active.summary : "no data"}`
              : null}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[2px] ${NO_DATA_CLASS}`} />
            <span>No data</span>
            <span className="mx-1">Less</span>
            {LEVEL_CLASSES.map((className, index) => (
              <span key={index} className={`h-2.5 w-2.5 rounded-[2px] ${className}`} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
