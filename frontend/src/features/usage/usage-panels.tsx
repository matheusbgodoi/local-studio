"use client";

import type { ReactNode } from "react";
import { ProgressBar } from "@/ui";
import { UNAVAILABLE } from "@/features/usage/usage-formatters";

export interface Metric {
  label: string;
  value: string;
  hint?: string;
}

interface HeroSide {
  label: string;
  value: string;
  sub: string;
  share: number;
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

function HeroColumn({ side, className }: { side: HeroSide; className: string }) {
  return (
    <div className={className}>
      <p className="text-[length:var(--fs-sm)] font-medium text-(--ui-muted)">{side.label}</p>
      <div className="mt-2 text-[clamp(2rem,4.6vw,3.25rem)] font-medium leading-none tracking-[-0.05em] tabular-nums text-(--ui-fg)">
        {side.value}
      </div>
      <p className="mt-2 text-[length:var(--fs-xs)] tabular-nums text-(--ui-muted)">{side.sub}</p>
      <ProgressBar progress={side.share} className="mt-2.5" barClassName="bg-(--ui-fg)/45" />
    </div>
  );
}

/**
 * Two figures whose magnitudes differ by an order of magnitude, at one type size.
 *
 * Type size in this system encodes hierarchy, not magnitude, so shrinking the smaller side
 * would tell the reader it does not matter — on the bench's own sample the two sides' total
 * energies are 1.3x apart, not 20x. The gap is carried three other ways instead: the
 * connector, which is exact arithmetic on the two rendered numbers and stays true in any
 * currency and with no tariff at all; the sub-line in a unit whose digit counts differ; and
 * two bars on one shared scale.
 */
export function HeroSplit({
  left,
  right,
  link,
  caption,
  footnote,
}: {
  left: HeroSide;
  right: HeroSide;
  link: { value: string; label: string };
  caption?: ReactNode;
  footnote?: string;
}) {
  return (
    <section className="mx-auto mt-8 max-w-[55rem]">
      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-[1fr_auto_1fr] sm:gap-8">
        <HeroColumn side={left} className="text-center sm:text-right" />
        <div className="text-center sm:self-center">
          <div className="text-[length:var(--fs-lg)] font-medium tabular-nums text-(--ui-fg)/70">
            {link.value}
          </div>
          <p className="mt-0.5 text-[length:var(--fs-2xs)] uppercase tracking-[0.08em] text-(--ui-muted)">
            {link.label}
          </p>
        </div>
        <HeroColumn side={right} className="text-center sm:text-left" />
      </div>
      {caption ? (
        <p className="mx-auto mt-6 max-w-[38rem] text-center text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
          {caption}
        </p>
      ) : null}
      {footnote ? (
        <p className="mx-auto mt-2 max-w-[44rem] text-center text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)/80">
          {footnote}
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
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--rad-xl)] bg-(--ui-surface)/60 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.1em] text-(--ui-muted)">
          {title}
        </h3>
        {badge ? (
          <span className="shrink-0 text-[length:var(--fs-2xs)] uppercase tracking-[0.08em] text-(--ui-muted)/70">
            {badge}
          </span>
        ) : null}
      </div>
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
  minWidthClass = "min-w-[34rem]",
}: {
  columns: string[];
  rows: Array<{ key: string; cells: string[] }>;
  emptyLabel: string;
  minWidthClass?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[length:var(--fs-xs)] text-(--ui-muted)">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidthClass} border-collapse text-left`}>
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

export function PanelGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 }) {
  return (
    <section
      className={`mx-auto mt-5 grid max-w-[55rem] gap-3 ${
        columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"
      }`}
    >
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
