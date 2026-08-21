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

        {/* AI MODE IS THE DEFAULT AND GROSS IS THE OPT-IN, which is why the stored field is
            named for the OFF state: a boolean's absent value is false, so every preferences
            object that already exists in this browser reads as AI mode by construction rather
            than through a rescue clause.

            The sentence below is not decoration. AI mode is an ATTRIBUTION, not a discount —
            the bill that arrives is the gross — so the screen has to admit the larger number
            exists even while showing the smaller one. Measured on this rig: 24 of 42 resident
            hours ran under 5% utilisation, and one day held a model loaded for 7 hours at 1.5%,
            burning 916 Wh that was being charged to tokens. */}
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={preferences.grossEnergy}
            onChange={(event) => onChange({ ...preferences, grossEnergy: event.target.checked })}
          />
          <span className="min-w-0">
            <span className="block text-[length:var(--fs-xs)] text-(--ui-fg)">
              Charge the board&rsquo;s whole draw
            </span>
            <span className="mt-0.5 block text-[length:var(--fs-2xs)] leading-relaxed text-(--ui-muted)">
              Off, energy and cost count only what inference caused — above the idle floor, and
              never while no model was loaded. On, they count every watt the board drew, which is
              the figure your meter is closer to.
            </span>
          </span>
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
