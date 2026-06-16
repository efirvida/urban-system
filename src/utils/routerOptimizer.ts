import { Location, Config, DayRoute, Stop } from "@/types";
import { haversineDistance } from "./haversine";

// ─── Internal types ───────────────────────────────────────────

interface SavingsPair {
  i: number; // index in locations array
  j: number; // index in locations array
  savings: number;
}

interface RouteCluster {
  indices: number[]; // indices into the original locations array
  totalTravelKm: number;
  totalVisitTimeMin: number;
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Main entry point: given a list of locations and user configuration,
 * group them into daily routes respecting the constraint.
 *
 * Algorithm: Clarke & Wright Savings for clustering,
 * Nearest Neighbor for intra-route ordering.
 */
export function optimizeRoutes(
  locations: Location[],
  config: Config
): { days: DayRoute[]; totalDistance: number } {
  if (locations.length === 0) {
    return { days: [], totalDistance: 0 };
  }

  const home: Location = {
    name: "Casa",
    lat: config.homeLat,
    lng: config.homeLng,
  };

  // Step 1: Calculate savings for every pair of locations
  const savings = calculateSavings(locations, home);

  // Step 2: Build route clusters respecting the daily constraint
  const clusters = buildClusters(locations, home, savings, config);

  // Step 3: Order each cluster's stops using Nearest Neighbor
  const days = orderClusters(clusters, locations, home, config);

  const totalDistance = days.reduce((sum, d) => sum + d.totalDistance, 0);

  return { days, totalDistance };
}

// ─── Step 1: Savings Calculation (Clarke & Wright) ────────────

function calculateSavings(
  locations: Location[],
  home: Location
): SavingsPair[] {
  const pairs: SavingsPair[] = [];

  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const dHomeToI = haversineDistance(
        home.lat, home.lng,
        locations[i].lat, locations[i].lng
      );
      const dHomeToJ = haversineDistance(
        home.lat, home.lng,
        locations[j].lat, locations[j].lng
      );
      const dIToJ = haversineDistance(
        locations[i].lat, locations[i].lng,
        locations[j].lat, locations[j].lng
      );

      // Savings: S(i,j) = D(home,i) + D(home,j) - D(i,j)
      const savings = dHomeToI + dHomeToJ - dIToJ;

      pairs.push({ i, j, savings });
    }
  }

  // Sort descending by savings
  pairs.sort((a, b) => b.savings - a.savings);

  return pairs;
}

// ─── Step 2: Cluster Building ─────────────────────────────────

function buildClusters(
  locations: Location[],
  home: Location,
  savings: SavingsPair[],
  config: Config
): RouteCluster[] {
  const n = locations.length;
  // Track which cluster each location belongs to (-1 = unassigned)
  const assignment = new Array<number>(n).fill(-1);
  const clusters: RouteCluster[] = [];

  // Helper: check if adding a location to a cluster would violate the constraint
  function canAddToCluster(
    cluster: RouteCluster,
    locationIdx: number
  ): boolean {
    return !wouldViolateConstraint(
      cluster,
      locationIdx,
      locations,
      home,
      config
    );
  }

  // Process savings pairs from highest to lowest
  for (const pair of savings) {
    const assignedI = assignment[pair.i];
    const assignedJ = assignment[pair.j];

    if (assignedI === -1 && assignedJ === -1) {
      // Neither is assigned — create a new cluster
      const newCluster: RouteCluster = {
        indices: [pair.i, pair.j],
        totalTravelKm: 0,
        totalVisitTimeMin: 0,
      };
      // Verify constraint
      if (!wouldClusterViolateConstraint(newCluster, locations, home, config)) {
        clusters.push(newCluster);
        assignment[pair.i] = clusters.length - 1;
        assignment[pair.j] = clusters.length - 1;
      }
    } else if (assignedI !== -1 && assignedJ === -1) {
      // i is in a cluster, j is free — try to add j to i's cluster
      const cluster = clusters[assignedI];
      if (canAddToCluster(cluster, pair.j)) {
        cluster.indices.push(pair.j);
        assignment[pair.j] = assignedI;
      }
    } else if (assignedI === -1 && assignedJ !== -1) {
      // j is in a cluster, i is free — try to add i to j's cluster
      const cluster = clusters[assignedJ];
      if (canAddToCluster(cluster, pair.i)) {
        cluster.indices.push(pair.i);
        assignment[pair.i] = assignedJ;
      }
    }
    // Both already assigned — skip (merging clusters would be complex)
  }

  // Assign any remaining unassigned locations to their own clusters
  for (let i = 0; i < n; i++) {
    if (assignment[i] === -1) {
      const soloCluster: RouteCluster = {
        indices: [i],
        totalTravelKm: 0,
        totalVisitTimeMin: 0,
      };
      if (!wouldClusterViolateConstraint(soloCluster, locations, home, config)) {
        clusters.push(soloCluster);
        assignment[i] = clusters.length - 1;
      } else {
        // This location alone exceeds the daily limit — that's an edge case
        // We still add it as its own day (user will need to adjust constraints)
        clusters.push(soloCluster);
        assignment[i] = clusters.length - 1;
      }
    }
  }

  return clusters;
}

// ─── Constraint Check ─────────────────────────────────────────

function wouldClusterViolateConstraint(
  cluster: RouteCluster,
  locations: Location[],
  home: Location,
  config: Config
): boolean {
  // Calculate round-trip distance for this cluster
  // Use a simple estimate: home → farthest point × 2 + some internal travel
  // For exact check, we'd need the ordered route, but this is a heuristic
  const indices = cluster.indices;

  if (indices.length === 0) return false;

  // Sum of distances from home to each location and back (worst case)
  // This is a conservative estimate
  let totalDistance = 0;
  for (const idx of indices) {
    totalDistance +=
      haversineDistance(home.lat, home.lng, locations[idx].lat, locations[idx].lng) * 2;
  }

  // More accurate: approximate as home → farthest + internal + home from farthest
  const distsFromHome = indices.map((idx) =>
    haversineDistance(home.lat, home.lng, locations[idx].lat, locations[idx].lng)
  );
  const maxDistFromHome = Math.max(...distsFromHome);
  const minDistFromHome = Math.min(...distsFromHome);

  // Rough internal travel: average distance between consecutive points
  let internalTravel = 0;
  if (indices.length > 1) {
    for (let k = 0; k < indices.length - 1; k++) {
      internalTravel += haversineDistance(
        locations[indices[k]].lat, locations[indices[k]].lng,
        locations[indices[k + 1]].lat, locations[indices[k + 1]].lng
      );
    }
  }

  // Best estimate: go to farthest via nearest points, then back
  const estimatedRouteDistance = maxDistFromHome + internalTravel + minDistFromHome;

  return checkConstraint(
    estimatedRouteDistance,
    indices.length,
    config
  );
}

function wouldViolateConstraint(
  cluster: RouteCluster,
  newLocationIdx: number,
  locations: Location[],
  home: Location,
  config: Config
): boolean {
  const proposedIndices = [...cluster.indices, newLocationIdx];
  const n = proposedIndices.length;

  // Estimate route distance with the new point included
  const distsFromHome = proposedIndices.map((idx) =>
    haversineDistance(home.lat, home.lng, locations[idx].lat, locations[idx].lng)
  );
  const maxDistFromHome = Math.max(...distsFromHome);
  const minDistFromHome = Math.min(...distsFromHome);

  let internalTravel = 0;
  if (n > 1) {
    for (let k = 0; k < n - 1; k++) {
      internalTravel += haversineDistance(
        locations[proposedIndices[k]].lat, locations[proposedIndices[k]].lng,
        locations[proposedIndices[k + 1]].lat, locations[proposedIndices[k + 1]].lng
      );
    }
  }

  const estimatedRouteDistance = maxDistFromHome + internalTravel + minDistFromHome;

  return checkConstraint(estimatedRouteDistance, n, config);
}

function checkConstraint(
  routeDistanceKm: number,
  numStops: number,
  config: Config
): boolean {
  switch (config.constraintType) {
    case "hours": {
      // Travel time = distance / speed (hours)
      // Visit time = numStops * visitTime (minutes converted to hours)
      const travelHours = routeDistanceKm / config.avgSpeed;
      const visitHours = (numStops * config.visitTime) / 60;
      const totalHours = travelHours + visitHours;
      return totalHours > config.constraintValue;
    }
    case "visits":
      return numStops > config.constraintValue;
    case "capacity":
      return numStops > config.constraintValue;
    default:
      return false;
  }
}

// ─── Step 3: Intra-route Ordering (Nearest Neighbor) ──────────

function orderClusters(
  clusters: RouteCluster[],
  locations: Location[],
  home: Location,
  config: Config
): DayRoute[] {
  return clusters.map((cluster, dayIdx) => {
    // Nearest Neighbor starting from home
    const ordered = nearestNeighborOrder(cluster.indices, locations, home);

    // Build stop list
    const stops: Stop[] = [];
    let cumulativeDist = 0;
    let cumulativeTime = 0;

    // Start at home
    stops.push({
      sequence: 0,
      name: home.name,
      lat: home.lat,
      lng: home.lng,
      distanceFromPrev: 0,
      cumulativeDistance: 0,
      cumulativeTime: 0,
      isHome: true,
    });

    let prevLat = home.lat;
    let prevLng = home.lng;

    for (const idx of ordered) {
      const d = haversineDistance(prevLat, prevLng, locations[idx].lat, locations[idx].lng);
      const t = d / config.avgSpeed; // travel hours
      cumulativeDist += d;
      cumulativeTime += t + config.visitTime / 60; // travel + visit

      stops.push({
        sequence: stops.length,
        name: locations[idx].name,
        lat: locations[idx].lat,
        lng: locations[idx].lng,
        distanceFromPrev: d,
        cumulativeDistance: cumulativeDist,
        cumulativeTime: cumulativeTime,
        isHome: false,
      });

      prevLat = locations[idx].lat;
      prevLng = locations[idx].lng;
    }

    // Return to home
    const returnDist = haversineDistance(prevLat, prevLng, home.lat, home.lng);
    const returnTime = returnDist / config.avgSpeed;
    cumulativeDist += returnDist;
    cumulativeTime += returnTime;

    stops.push({
      sequence: stops.length,
      name: home.name,
      lat: home.lat,
      lng: home.lng,
      distanceFromPrev: returnDist,
      cumulativeDistance: cumulativeDist,
      cumulativeTime: cumulativeTime,
      isHome: true,
    });

    return {
      day: dayIdx + 1,
      stops,
      totalDistance: cumulativeDist,
      totalTime: cumulativeTime,
      totalStops: ordered.length,
    };
  });
}

/**
 * Nearest Neighbor heuristic: starting from home, repeatedly visit
 * the closest unvisited location.
 */
function nearestNeighborOrder(
  indices: number[],
  locations: Location[],
  home: Location
): number[] {
  if (indices.length === 0) return [];
  if (indices.length === 1) return [indices[0]];

  const unvisited = new Set(indices);
  const ordered: number[] = [];
  let currentLat = home.lat;
  let currentLng = home.lng;

  while (unvisited.size > 0) {
    let nearestIdx: number | null = null;
    let nearestDist = Infinity;

    for (const idx of Array.from(unvisited)) {
      const d = haversineDistance(
        currentLat,
        currentLng,
        locations[idx].lat,
        locations[idx].lng
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    }

    if (nearestIdx !== null) {
      ordered.push(nearestIdx);
      currentLat = locations[nearestIdx].lat;
      currentLng = locations[nearestIdx].lng;
      unvisited.delete(nearestIdx);
    }
  }

  return ordered;
}
