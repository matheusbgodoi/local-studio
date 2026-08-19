"use client";

import type { ReactNode } from "react";
import { UNAVAILABLE } from "@/features/usage/usage-formatters";

export interface Metric {
  label: string;
  value: string;
  hint?: string;
}

export function HeroMetric({
  value,
  label,
  caption,
}: {
  value: string;
  label: string;
  caption?: string;
}) {
  return (
    <section className="mx-auto mt-8 max-w-[55rem] text-center">
      <p className="text-[length:var(--fs-sm)] font-medium text-(--ui-muted)">{label}</p>
      <div className="mt-2 text-[clamp(2.75rem,7vw,4.75rem)] font-medium leading-none tracking-[-0.055em] tabular-nums text-(--ui-fg)">
        {value}
      </div>
      {caption ? (
        <p className="mx-auto mt-3 max-w-[34rem] text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
          {caption}
        </p>
      ) : null}
    </section>
  );
}

export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return null;
  return (
    <dl className="mx-auto mt-8 grid max-w-[55rem] grid-cols-2 divide-x divide-y divide-(--ui-border) rounded-[var(--rad-xl)] bg-(--ui-surface) sm:grid-cols-3 lg:grid-cols-6">
      {metrics.map((metric) => (
        <div key={metric.label} className="px-4 py-3.5" title={metric.hint}>
          <dt className="text-[length:var(--fs-2xs)] uppercase tracking-[0.08em] text-(--ui-muted)">
            {metric.label}
          </dt>
          <dd className="mt-1 text-[length:var(--fs-md)] font-medium tabular-nums text-(--ui-fg)">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">
      <h3 className="text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.1em] text-(--ui-muted)">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
          {description}
        </p>
      ) : null}
      <div className="mt-3.5">{children}</div>
    </div>
  );
}

export function MetricRows({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="space-y-2">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="flex items-baseline justify-between gap-4"
          title={metric.hint}
        >
          <dt className="text-[length:var(--fs-xs)] text-(--ui-muted)">{metric.label}</dt>
          <dd className="text-[length:var(--fs-sm)] font-medium tabular-nums text-(--ui-fg)">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function BreakdownTable({
  columns,
  rows,
  emptyLabel,
}: {
  columns: string[];
  rows: Array<{ key: string; cells: string[] }>;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[length:var(--fs-xs)] text-(--ui-muted)">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                className={`pb-2 text-[length:var(--fs-2xs)] font-normal uppercase tracking-[0.08em] text-(--ui-muted) ${
                  index === 0 ? "" : "text-right"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-(--ui-border)">
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  className={`py-2 text-[length:var(--fs-xs)] tabular-nums ${
                    index === 0
                      ? "font-medium text-(--ui-fg)"
                      : `text-right ${cell === UNAVAILABLE ? "text-(--ui-muted)/60" : "text-(--ui-fg)/85"}`
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PanelGrid({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto mt-5 grid max-w-[55rem] gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </section>
  );
}

export function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto mt-6 max-w-[55rem]">
      <h2 className="mb-3 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.1em] text-(--ui-muted)">
        {title}
      </h2>
      <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">{children}</div>
    </section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-8 max-w-[42rem] rounded-[var(--rad-xl)] bg-(--ui-surface)/60 px-5 py-4 text-center text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
      {children}
    </p>
  );
}
