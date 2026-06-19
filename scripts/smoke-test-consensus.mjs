#!/usr/bin/env node
/**
 * Smoke test for consensus-matrix — calls each provider and the
 * ConsensusBuilder with real API keys from .env.local.
 *
 * Usage: npx tsx scripts/smoke-test-consensus.mjs
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync } from "fs";

// ── Load .env.local (manual parse, no dotenv dependency) ────
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
try {
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  console.log("✔ .env.local loaded");
} catch {
  console.warn("⚠ No .env.local found");
}

// ── Test points: home + 4 POIs around Montevideo ─────────────
const testPoints = [
  { lat: -34.9011, lng: -56.1645 },  // home (Centro)
  { lat: -34.9050, lng: -56.1910 },  // POI 1 (Punta Carretas)
  { lat: -34.8833, lng: -56.1817 },  // POI 2 (Cordón)
  { lat: -34.9100, lng: -56.1460 },  // POI 3 (Pocitos)
  { lat: -34.9200, lng: -56.1590 },  // POI 4 (Buceo)
];

let passed = 0;
let failed = 0;

function assert(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── Import providers ─────────────────────────────────────────
const { GeoapifyMatrixProvider } = await import(
  "../src/utils/routing/providers/geoapifyMatrix.ts"
);
const { OrsMatrixProvider } = await import(
  "../src/utils/routing/providers/orsMatrix.ts"
);
const { OSRMProvider } = await import(
  "../src/utils/routing/providers/osrm.ts"
);
const { ConsensusBuilder } = await import(
  "../src/utils/routing/consensusBuilder.ts"
);

// Since OSRMProvider.route() is a per-pair method, we need to also
// import the RouteProvider type
const providerTypes = await import("../src/utils/routing/types.ts");

// ── Test 1: GeoapifyMatrixProvider ───────────────────────────
console.log("\n═══ GeoapifyMatrixProvider ═══");
const geoapify = new GeoapifyMatrixProvider();
const geoResult = await geoapify.buildMatrix(testPoints);

assert(
  "buildMatrix returned a Map",
  geoResult instanceof Map,
  typeof geoResult,
);
if (geoResult.size === 0) {
  console.log("  ⚠ Geoapify returned 0 pairs (key may be invalid or expired)");
  console.log("  → This is expected if the current GEOAPIFY_API_KEY is not valid");
} else {
  let geoFinite = 0;
  let geoNull = 0;
  for (const [k, v] of geoResult) {
    if (v === null) geoNull++;
    else geoFinite++;
  }
  console.log(`  → ${geoResult.size} total pairs (${geoFinite} finite, ${geoNull} null)`);
}

// ── Test 2: OrsMatrixProvider ────────────────────────────────
console.log("\n═══ OrsMatrixProvider ═══");
const ors = new OrsMatrixProvider();
const orsResult = await ors.buildMatrix(testPoints);

assert(
  "buildMatrix returned a Map",
  orsResult instanceof Map,
  typeof orsResult,
);

let orsFinite = 0;
let orsNull = 0;
for (const [k, v] of orsResult) {
  if (v === null) orsNull++;
  else orsFinite++;
}
assert(
  "Some pairs resolved",
  orsFinite > 0,
  `${orsFinite} finite, ${orsNull} null`,
);
console.log(`  → ${orsResult.size} total pairs (${orsFinite} finite, ${orsNull} null)`);

// ── Test 3: OSRMProvider (per-pair) ──────────────────────────
console.log("\n═══ OSRMProvider ═══");
const osrm = new OSRMProvider();
const osrmResult = await osrm.route(testPoints[0], testPoints[1]);

assert(
  "route returned a result",
  osrmResult !== null,
  osrmResult === null ? "null" : "ok",
);

if (osrmResult) {
  assert(
    "distance is finite",
    Number.isFinite(osrmResult.distanceKm),
    `${osrmResult.distanceKm} km`,
  );
  assert(
    "duration is present",
    typeof osrmResult.durationSeconds === "number",
    `${osrmResult.durationSeconds}s`,
  );
  assert(
    "source is 'osrm'",
    osrmResult.source === "osrm",
    osrmResult.source,
  );
  console.log(`  → ${osrmResult.distanceKm.toFixed(2)} km, ${osrmResult.durationSeconds}s`);
}

// ── Test 4: ConsensusBuilder (3 providers) ───────────────────
console.log("\n═══ ConsensusBuilder (3 providers) ═══");
const builder = new ConsensusBuilder([geoapify, ors], osrm);
const consensus = await builder.build(testPoints);

const entries = Object.keys(consensus).length;
assert(
  "ConsensusMatrix has all upper-triangle pairs",
  entries === (testPoints.length * (testPoints.length - 1)) / 2,
  `${entries} / ${(testPoints.length * (testPoints.length - 1)) / 2}`,
);

let highConf = 0, lowConf = 0, unreachable = 0;
for (const [k, entry] of Object.entries(consensus)) {
  if (entry.source === "unreachable") unreachable++;
  else if (entry.reliability >= 0.67) highConf++;
  else lowConf++;
}
assert(
  "Some entries reachable",
  highConf + lowConf > 0,
  `${highConf} high-conf, ${lowConf} low-conf, ${unreachable} unreachable`,
);
assert(
  "Every entry has at least 1 vote",
  Object.values(consensus).every((e) => e.votes.length >= 1),
  Object.values(consensus).some((e) => e.votes.length === 0) ? "found entry with 0 votes" : "ok",
);

// Log every entry
for (const [k, entry] of Object.entries(consensus).sort()) {
  const dist = Number.isFinite(entry.distance)
    ? `${entry.distance.toFixed(2)} km`
    : "∞";
  console.log(
    `  pair ${k}: ${dist}  rel=${entry.reliability.toFixed(2)}  ` +
    `src=${entry.source}  votes=${entry.votes.length}`,
  );
}

// ── Test 5: ConsensusBuilder (2 providers — no ORS) ─────────
console.log("\n═══ ConsensusBuilder (2 providers — no ORS) ═══");
const savedKey = process.env.ORS_API_KEY;
delete process.env.ORS_API_KEY;
const ors2 = new OrsMatrixProvider();
const builder2 = new ConsensusBuilder([geoapify, ors2], osrm);
const consensus2 = await builder2.build(testPoints);
if (savedKey) process.env.ORS_API_KEY = savedKey;

const entries2 = Object.keys(consensus2).length;
assert(
  "2-provider consensus has all pairs",
  entries2 === (testPoints.length * (testPoints.length - 1)) / 2,
  `${entries2} entries`,
);

let unreachable2 = 0;
for (const entry of Object.values(consensus2)) {
  if (entry.source === "unreachable") unreachable2++;
}
console.log(`  → ${entries2} entries, ${unreachable2} unreachable`);

// ── Test 6: Cache hit on repeat call (Geoapify) ──────────────
console.log("\n═══ Cache hit (Geoapify) ═══");
const start = Date.now();
const geoResult2 = await geoapify.buildMatrix(testPoints);
const elapsed = Date.now() - start;

assert(
  "Second call returns same number of pairs",
  geoResult2.size === geoResult.size,
  `${geoResult2.size} vs ${geoResult.size}`,
);
assert(
  "Second call is fast (< 50ms = cache hit)",
  elapsed < 50,
  `${elapsed}ms`,
);
console.log(`  → ${elapsed}ms (cache hit ✓)`);

// ── Summary ──────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✔ All smoke tests passed!");
