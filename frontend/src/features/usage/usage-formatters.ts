import { formatNumber } from "@/lib/formatters";

export const UNAVAILABLE = "—";

export function exactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return Math.round(value).toLocaleString();
}

export function compactTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return formatNumber(value);
}

export function perKwh(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return formatNumber(Math.round(value));
}

export function decimals(value: number | null | undefined, places: number, unit = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return `${value.toFixed(places)}${unit}`;
}

export function percent(value: number | null | undefined, places = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return `${value.toFixed(places)}%`;
}

export function milliseconds(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return UNAVAILABLE;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${total}s`;
}

export function kilowattHours(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  if (value > 0 && value < 0.01) return `${value.toFixed(4)} kWh`;
  return `${value.toFixed(2)} kWh`;
}

export function watts(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return `${Math.round(value)} W`;
}

export function tokensPerSecond(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return `${value.toFixed(1)} tok/s`;
}

export function money(value: number | null | undefined, currency: string, places = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(value);
  } catch {
    return `${value.toFixed(places)} ${currency}`;
  }
}

export function dayLabel(date: string, timezone: string): string {
  const at = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return date;
  try {
    return at.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: timezone,
    });
  } catch {
    return date;
  }
}

export function instantLabel(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return at.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });
  } catch {
    return at.toISOString().slice(0, 16).replace("T", " ");
  }
}
