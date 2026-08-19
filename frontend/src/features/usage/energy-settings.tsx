"use client";

import { Select } from "@/ui";
import {
  currencyOptions,
  timezoneOptions,
  type EnergyPreferences,
} from "@/features/usage/energy-preferences";
import { PanelCard } from "@/features/usage/usage-panels";

const FIELD_CLASSES =
  "h-8 w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-2.5 text-[length:var(--fs-xs)] text-(--ui-fg) transition-colors focus:border-(--ui-accent)/60 focus:outline-none focus:ring-1 focus:ring-(--ui-accent)/20";

export function EnergySettings({
  preferences,
  onChange,
}: {
  preferences: EnergyPreferences;
  onChange: (next: EnergyPreferences) => void;
}) {
  const commitRate = (raw: string) => {
    const parsed = Number(raw.replace(",", "."));
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    if (next !== preferences.pricePerKwh) onChange({ ...preferences, pricePerKwh: next });
  };

  return (
    <PanelCard
      title="Electricity"
      description="Cost is your rate times measured energy. Nothing is fetched and no rate is assumed."
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[length:var(--fs-2xs)] uppercase tracking-[0.08em] text-(--ui-muted)">
            Currency
          </span>
          <Select
            className="h-8 text-[length:var(--fs-xs)]"
            value={preferences.currency}
            onChange={(event) => onChange({ ...preferences, currency: event.target.value })}
            options={currencyOptions().map((code) => ({ value: code, label: code }))}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[length:var(--fs-2xs)] uppercase tracking-[0.08em] text-(--ui-muted)">
            Rate per kWh
          </span>
          <input
            key={preferences.pricePerKwh ?? "unset"}
            className={FIELD_CLASSES}
            inputMode="decimal"
            placeholder="Set electricity rate"
            defaultValue={preferences.pricePerKwh === null ? "" : String(preferences.pricePerKwh)}
            onBlur={(event) => commitRate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRate(event.currentTarget.value);
            }}
            aria-label={`Electricity rate per kWh in ${preferences.currency}`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[length:var(--fs-2xs)] uppercase tracking-[0.08em] text-(--ui-muted)">
            Calendar timezone
          </span>
          <Select
            className="h-8 text-[length:var(--fs-xs)]"
            value={preferences.timezone}
            onChange={(event) => onChange({ ...preferences, timezone: event.target.value })}
            options={timezoneOptions().map((zone) => ({ value: zone, label: zone }))}
          />
        </label>
      </div>
    </PanelCard>
  );
}
