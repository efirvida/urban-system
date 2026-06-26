import { describe, expect, it, vi } from 'vitest';
import { matGet } from '@/utils/routerOptimizer';
import type { DistanceMatrix, MatrixEntry } from '@/types';

function entry(distance: number, source: MatrixEntry['source'] = 'real'): MatrixEntry {
  return { distance, source };
}

describe('matGet', () => {
  it('returns the per-pair distance from the strict matrix', () => {
    const matrix: DistanceMatrix = {
      '0,1': entry(1.5),
      '1,2': entry(2.7),
      '0,2': entry(4.0),
    };
    expect(matGet(-1, 0, undefined, matrix)).toBe(1.5); // home → poi-0
    expect(matGet(0, 1, undefined, matrix)).toBe(2.7); // poi-0 → poi-1
    expect(matGet(-1, 1, undefined, matrix)).toBe(4.0); // home → poi-1
  });

  it('returns Infinity for a missing key and logs a single warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const matrix: DistanceMatrix = {
      '0,1': entry(1.5),
    };
    const d = matGet(0, 1, undefined, matrix); // poi-0 → poi-1, missing
    expect(d).toBe(Infinity);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/matGet/);
    warn.mockRestore();
  });

  it('falls back to the flat matrix when the strict matrix is missing a key', () => {
    const strict: DistanceMatrix = { '0,1': entry(1.5) };
    const flat = { '0,1': 1.5, '1,2': 0.7 };
    // poi-0 → poi-1: not in strict, present in flat
    expect(matGet(0, 1, flat, strict)).toBe(0.7);
  });

  it('swaps (a, b) so the canonical key (min, max) is always looked up', () => {
    const matrix: DistanceMatrix = { '1,3': entry(2.2) };
    // matGet(2, 0) should resolve to key "1,3" (min(0+1, 2+1) = 1,
    // max = 3) regardless of the order of the indices.
    expect(matGet(2, 0, undefined, matrix)).toBe(2.2);
  });
});
