import { describe, expect, it } from 'vitest';
import { filterUnreachable } from '@/utils/unreachableFilter';
import type { Location, DistanceMatrix, MatrixEntry } from '@/types';
import { TINY_DISTANCE_KM } from '@/utils/constants';

const HOME: Location = { name: 'home', lat: 0, lng: 0 };

function entry(distance: number, source: MatrixEntry['source'] = 'real'): MatrixEntry {
  return { distance, source };
}

function makeLocations(n: number): Location[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `poi-${i}`,
    lat: i * 0.01,
    lng: i * 0.01,
  }));
}

describe('filterUnreachable', () => {
  it('treats every POI as reachable when the matrix is all real', () => {
    const locations = makeLocations(3);
    // Key format is "i,j" with i < j, where 0 = home, 1..n = POIs.
    const matrix: DistanceMatrix = {
      '0,1': entry(1.2),
      '0,2': entry(2.4),
      '0,3': entry(3.6),
      '1,2': entry(1.1),
      '1,3': entry(2.2),
      '2,3': entry(1.3),
    };
    const { reachable, unreachable } = filterUnreachable(locations, HOME, matrix);
    expect(reachable).toHaveLength(3);
    expect(unreachable).toHaveLength(0);
  });

  it("flags a single unreachable POI with reason 'no_road_connection'", () => {
    const locations = makeLocations(2);
    const matrix: DistanceMatrix = {
      '0,1': entry(1.2),
      '0,2': entry(Infinity, 'unreachable'),
      '1,2': entry(0.5),
    };
    const { reachable, unreachable } = filterUnreachable(locations, HOME, matrix);
    expect(reachable).toHaveLength(1);
    expect(reachable[0]!.name).toBe('poi-0');
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0]!.name).toBe('poi-1');
    expect(unreachable[0]!.reason).toBe('no_road_connection');
  });

  it("treats a tiny (< 50 m) entry as reachable even when not tagged 'real'", () => {
    const locations = makeLocations(1);
    // Estimated distance below the tiny-pair threshold should still
    // count as reachable per the strict-matrix contract.
    const matrix: DistanceMatrix = {
      '0,1': entry(TINY_DISTANCE_KM / 2, 'estimated'),
    };
    const { reachable, unreachable } = filterUnreachable(locations, HOME, matrix);
    expect(reachable).toHaveLength(1);
    expect(unreachable).toHaveLength(0);
  });

  it('flags every POI unreachable when the matrix is empty', () => {
    const locations = makeLocations(3);
    const matrix: DistanceMatrix = {};
    const { reachable, unreachable } = filterUnreachable(locations, HOME, matrix);
    expect(reachable).toHaveLength(0);
    expect(unreachable).toHaveLength(3);
  });
});
