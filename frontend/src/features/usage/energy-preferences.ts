"use client";

import { useCallback, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const STORAGE_KEY = "local-studio.usage.energy";
const PREFERENCES_EVENT = "local-studio:usage-energy-preferences";

export const DEFAULT_CURRENCY = "BRL";
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

const FALLBACK_CURRENCIES = ["BRL", "USD", "EUR", "GBP"];

export interface EnergyPreferences {
  currency: string;
  pricePerKwh: number | null;
  timezone: string;
}

export const DEFAULT_ENERGY_PREFERENCES: EnergyPreferences = {
  currency: DEFAULT_CURRENCY,
  pricePerKwh: null,
  timezone: DEFAULT_TIMEZONE,
};

function supported(key: "currency" | "timeZone"): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    const values = intl.supportedValuesOf?.(key);
    if (Array.isArray(values) && values.length > 0) return values;
  } catch {
    return [];
  }
  return [];
}

export function currencyOptions(): string[] {
  const values = supported("currency");
  if (values.length === 0) return FALLBACK_CURRENCIES;
  const preferred = FALLBACK_CURRENCIES.filter((code) => values.includes(code));
  return [...preferred, ...values.filter((code) => !preferred.includes(code))];
}

export function timezoneOptions(): string[] {
  const values = supported("timeZone");
  if (values.length === 0) return [DEFAULT_TIMEZONE, "UTC"];
  return values.includes(DEFAULT_TIMEZONE) ? values : [DEFAULT_TIMEZONE, ...values];
}

export function readEnergyPreferences(storage: Pick<Storage, "getItem">): EnergyPreferences {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_ENERGY_PREFERENCES;
  }
  if (!raw) return DEFAULT_ENERGY_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<EnergyPreferences>;
    const rate = Number(parsed.pricePerKwh);
    return {
      currency:
        typeof parsed.currency === "string" && /^[A-Z]{3}$/.test(parsed.currency)
          ? parsed.currency
          : DEFAULT_CURRENCY,
      pricePerKwh: Number.isFinite(rate) && rate > 0 ? rate : null,
      timezone:
        typeof parsed.timezone === "string" && parsed.timezone ? parsed.timezone : DEFAULT_TIMEZONE,
    };
  } catch {
    return DEFAULT_ENERGY_PREFERENCES;
  }
}

export function writeEnergyPreferences(
  storage: Pick<Storage, "setItem">,
  value: EnergyPreferences,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    return;
  }
}

export function useEnergyPreferences(): [EnergyPreferences, (next: EnergyPreferences) => void] {
  const [preferences, setPreferences] = useState<EnergyPreferences>(DEFAULT_ENERGY_PREFERENCES);
  useMountSubscription(() => {
    const sync = () => setPreferences(readEnergyPreferences(window.localStorage));
    sync();
    window.addEventListener(PREFERENCES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((next: EnergyPreferences) => {
    setPreferences(next);
    writeEnergyPreferences(window.localStorage, next);
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
  }, []);
  return [preferences, update];
}
