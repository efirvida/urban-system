import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind CSS classes with conflict resolution */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format distance in km to a readable string.
 *
 * The numeric part uses `Intl.NumberFormat` so the decimal separator
 * matches the active locale (`1.2 km` in `en/es`, `1,2 km` in `pt-BR`).
 * Unit suffixes (`km`, `m`) are caller-supplied — the compact Latin
 * abbreviations are universally understood and don't need translation.
 */
export function formatDistance(km: number, locale = "pt-BR"): string {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  return `${fmt.format(km)} km`;
}

/**
 * Format hours to a readable duration string.
 *
 * The `locale` parameter is accepted for signature parity with
 * `formatDistance`; the rendered output is unit-based (`Xh Ymin`) and
 * doesn't use locale-sensitive number formatting yet.
 */
export function formatDuration(hours: number, _locale = "pt-BR"): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/** Route color palette — distinct colors for up to 12 days */
export const ROUTE_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#84cc16", // lime
  "#d946ef", // fuchsia
];

export function getRouteColor(dayIndex: number): string {
  return ROUTE_COLORS[dayIndex % ROUTE_COLORS.length];
}
