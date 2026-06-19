/**
 * In-memory cache for optimizer results.
 *
 * Scope: server-side, per-process. Survives across requests but is
 * cleared on server restart. 24h TTL matches the proposal. The map is
 * bounded — when it grows past `MAX_ENTRIES`, the 20 oldest entries are
 * evicted on every write so a busy server doesn't accumulate stale
 * state forever.
 *
 * Keyed by a djb2 hash of the sorted locations + config string. The
 * `home` coordinate is part of `config` (it lives in `params.home`,
 * which the route layer derives from `config.homeLat/homeLng` and
 * appends to the locations array before hashing).
 */

import type { Config, Location } from "@/types";
import type { OptimizerResult } from "./types";

interface CacheEntry {
  result: OptimizerResult;
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;
const EVICT_BATCH = 20;

const cache = new Map<string, CacheEntry>();

/** Build a stable cache key from the locations + config the route runs. */
export function optimizerCacheKey(
  locations: Location[],
  config: Config,
): string {
  const locHash = locations
    .map((l) => `${l.lat.toFixed(5)},${l.lng.toFixed(5)}`)
    .sort()
    .join("|");
  const cfgStr = [
    config.constraintType,
    config.constraintValue,
    config.maxVisits ?? "",
    config.avgSpeed,
    config.visitTime,
    config.homeLat.toFixed(5),
    config.homeLng.toFixed(5),
  ].join("|");
  let h = 5381;
  for (const s of locHash + "|" + cfgStr) {
    h = ((h << 5) + h + s.charCodeAt(0)) | 0;
  }
  return Math.abs(h).toString(36);
}

/** Return the cached result if present and fresh, else `null`. */
export function getCachedOptimizerResult(key: string): OptimizerResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

/** Store a result. Evicts the oldest 20 entries when the cache grows past the cap. */
export function setCachedOptimizerResult(key: string, result: OptimizerResult): void {
  cache.set(key, { result, timestamp: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );
    for (let i = 0; i < EVICT_BATCH && i < oldest.length; i++) {
      const entry = oldest[i];
      if (entry) cache.delete(entry[0]);
    }
  }
}

/** Clear the cache. Test-only — kept here so unit tests can reset state. */
export function _clearOptimizerCache(): void {
  cache.clear();
}
