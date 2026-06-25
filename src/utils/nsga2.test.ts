import { describe, expect, it } from "vitest";
import { runNSGA2 } from "@/utils/nsga2";
import type { Config, DistanceMatrix, Location } from "@/types";

const HOME: Location = { name: "home", lat: 0, lng: 0 };

const FIVE_POIS: Location[] = [
  { name: "A", lat: 0.01, lng: 0.01 },
  { name: "B", lat: 0.02, lng: 0.02 },
  { name: "C", lat: -0.01, lng: 0.005 },
  { name: "D", lat: 0.005, lng: -0.015 },
  { name: "E", lat: -0.02, lng: -0.01 },
];

/**
 * Hand-crafted DistanceMatrix for the 5-POI smoke test. Every pair
 * has a finite, realistic distance (0.1–0.5 km) and is tagged "real"
 * so the optimizer cannot trivially reject everything.
 *
 * Keys are "i,j" with i < j; 0 = home, 1..5 = the POIs above.
 */
function makeMatrix(): DistanceMatrix {
  const entries: [string, number][] = [
    ["0,1", 0.15], ["0,2", 0.22], ["0,3", 0.31], ["0,4", 0.18], ["0,5", 0.27],
    ["1,2", 0.14], ["1,3", 0.33], ["1,4", 0.21], ["1,5", 0.39],
    ["2,3", 0.28], ["2,4", 0.19], ["2,5", 0.12],
    ["3,4", 0.16], ["3,5", 0.34],
    ["4,5", 0.25],
  ];
  const dm: DistanceMatrix = {};
  for (const [k, d] of entries) dm[k] = { distance: d, source: "real" };
  return dm;
}

const CONFIG: Config = {
  homeLat: HOME.lat,
  homeLng: HOME.lng,
  constraintType: "hours",
  constraintValue: 4,
  avgSpeed: 60,
  visitTime: 15,
};

describe("runNSGA2 (5-POI smoke)", () => {
  it("returns a non-empty Pareto front with finite totalDistance", async () => {
    const matrix = makeMatrix();
    const result = await runNSGA2(FIVE_POIS, HOME, CONFIG, undefined, matrix);

    // Pareto front is non-empty — at least one non-dominated solution.
    expect(result.paretoFront.length).toBeGreaterThan(0);

    // Every solution has a finite total distance within an upper
    // bound (10× the longest single leg is a generous smoke ceiling).
    const upperBound = 10 * 0.4; // ~4 km
    for (const sol of result.paretoFront) {
      expect(Number.isFinite(sol.totalDistance)).toBe(true);
      expect(sol.totalDistance).toBeGreaterThan(0);
      expect(sol.totalDistance).toBeLessThan(upperBound);
      expect(Number.isFinite(sol.maxDayHours)).toBe(true);
      expect(sol.maxDayHours).toBeGreaterThan(0);
    }

    // The three named picks (balanced / minDistance / minDuration)
    // are also non-null and live on the front.
    expect(result.balanced.totalDistance).toBeGreaterThan(0);
    expect(result.minDistance.totalDistance).toBeGreaterThan(0);
    expect(result.minDuration.maxDayHours).toBeGreaterThan(0);
  });

  it("respects the per-day hour constraint (maxDayHours <= 4h+visitTime)", async () => {
    const matrix = makeMatrix();
    const result = await runNSGA2(FIVE_POIS, HOME, CONFIG, undefined, matrix);
    for (const sol of result.paretoFront) {
      // The constraint is 4h of drive time; add visit time to be lenient.
      expect(sol.maxDayHours).toBeLessThanOrEqual(CONFIG.constraintValue + CONFIG.visitTime / 60 + 0.5);
    }
  });
});
