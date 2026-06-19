#!/usr/bin/env node
/**
 * Test with real data from the spreadsheet + consensus matrix.
 * Loads data, runs consensus builder, then CW and NSGA-II optimizers.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env.local ─────────────────────────────────────────
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
try {
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  console.log("✔ .env.local loaded");
} catch { console.warn("⚠ No .env.local"); }

// ── Helpers ──────────────────────────────────────────────────
function dmsToDecimal(dms) {
  if (!dms || typeof dms !== "string") return null;
  dms = dms.replace(",", ".");
  const m = dms.match(/(-?\d+)[°](\d+)[\'']?([\d.]+)?[\'']?/);
  if (!m) return parseFloat(dms) || null;
  const deg = parseFloat(m[1]);
  const min = parseFloat(m[2] || 0);
  const sec = parseFloat(m[3] || 0);
  // Brazil = southern/western hemisphere. Decimal coords in the sheet
  // have explicit negatives; DMS ones omit the sign. Always negate DMS.
  if (dms.trim().startsWith("-")) {
    return -(Math.abs(deg) + min / 60 + sec / 3600);
  }
  return -(Math.abs(deg) + min / 60 + sec / 3600);
}

// ── Load spreadsheet ─────────────────────────────────────────
const XLSX = await import("xlsx");
const wb = XLSX.default.readFile("/home/efirvida/Downloads/PLANILHA PROPIEDADES.ods");
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
const rows = raw.slice(2).filter((r) => r[0]);

const home = { lat: -15.7332, lng: -47.8933, name: "CASA" };
const locations = [];
for (const r of rows) {
  let lat = r[5], lng = r[6];
  if (typeof lat === "string" && lat.includes("°")) lat = dmsToDecimal(lat);
  if (typeof lng === "string" && lng.includes("°")) lng = dmsToDecimal(lng);
  lat = parseFloat(lat);
  lng = parseFloat(lng);
  if (isNaN(lat) || isNaN(lng)) continue;
  locations.push({ name: String(r[0] || "").trim(), lat, lng });
}

console.log(`\n📊 ${locations.length} POIs loaded + home`);

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
const { RELIABILITY_FLOOR } = await import("../src/utils/constants.ts");

const geo = new GeoapifyMatrixProvider();
const ors = new OrsMatrixProvider();
const osrm = new OSRMProvider();

const points = [home, ...locations];
const totalPairs = (points.length * (points.length - 1)) / 2;
console.log(`Total pairs: ${totalPairs} (${points.length} points)`);

// ── Build consensus matrix ───────────────────────────────────
console.log("\n═══ Building consensus matrix ═══");
const t0 = Date.now();
const builder = new ConsensusBuilder([geo, ors], osrm);
const consensus = await builder.build(points);
console.log(`⏱ ${Date.now() - t0}ms`);

// ── Analyze per-provider coverage ────────────────────────────
const entries = Object.entries(consensus).filter(([k]) => k.startsWith("0,")); // home→POI only
const geoFinite = entries.filter(([_, e]) => e.votes.some(v => v.provider === "geoapify-matrix" && v.distance !== null)).length;
const orsFinite = entries.filter(([_, e]) => e.votes.some(v => v.provider === "ors-matrix" && v.distance !== null)).length;
const osrmFinite = entries.filter(([_, e]) => e.votes.some(v => v.provider === "osrm" && v.distance !== null)).length;
console.log(`Coverage (home→POI): Geoapify=${geoFinite}/${locations.length} · ORS=${orsFinite}/${locations.length} · OSRM=${osrmFinite}/${locations.length}`);

// ── Analyze reachability ─────────────────────────────────────
let reachable = 0, unreachable = 0;
for (let i = 0; i < locations.length; i++) {
  const key = `${0},${i + 1}`;
  const entry = consensus[key];
  if (entry && Number.isFinite(entry.distance) && entry.reliability >= RELIABILITY_FLOOR) {
    reachable++;
  } else {
    unreachable++;
    console.log(`  ⚠ UNREACHABLE: ${locations[i].name} — rel=${entry?.reliability?.toFixed(2) ?? "?"} dist=${Number.isFinite(entry?.distance) ? entry.distance.toFixed(1) + "km" : "∞"} votes=${entry?.votes?.length ?? 0}`);
  }
}
console.log(`Reachable: ${reachable}/${locations.length}, Unreachable: ${unreachable}`);

// ── Build effective matrix ───────────────────────────────────
const effective = {};
for (const [key, entry] of Object.entries(consensus)) {
  effective[key] = Number.isFinite(entry.distance) && entry.reliability >= RELIABILITY_FLOOR ? entry.distance : Infinity;
}
const reachableLocs = locations.filter((_, i) => {
  const key = `0,${i + 1}`;
  const e = consensus[key];
  return e && Number.isFinite(e.distance) && e.reliability >= RELIABILITY_FLOOR;
});
console.log(`\nReachable POIs for optimization: ${reachableLocs.length}`);

// ── Run CW (Clarke & Wright) ─────────────────────────────────
console.log("\n═══ Clarke & Wright ═══");
const { optimizeRoutes } = await import("../src/utils/routerOptimizer.ts");
const { default: Config } = await import("../src/types/index.ts");

const config = {
  homeLat: home.lat,
  homeLng: home.lng,
  constraintType: "hours",
  constraintValue: 8,
  avgSpeed: 60,
  visitTime: 30,
  maxVisits: 99,
};

const tCw = Date.now();
const cwResult = await optimizeRoutes(reachableLocs, config, effective);
console.log(`⏱ ${Date.now() - tCw}ms`);
console.log(`Days: ${cwResult.days.length}, Distance: ${cwResult.totalDistance.toFixed(1)}km`);

// Count POIs assigned
const cwPOIs = new Set();
for (const d of cwResult.days) {
  for (const s of d.stops) {
    if (!s.isHome) cwPOIs.add(s.name);
  }
}
console.log(`POIs assigned: ${cwPOIs.size}/${reachableLocs.length}`);
if (cwPOIs.size < reachableLocs.length) {
  const missing = reachableLocs.filter(l => !cwPOIs.has(l.name));
  for (const m of missing) console.log(`  ❌ Missing: ${m.name}`);
}

// ── Run NSGA-II ──────────────────────────────────────────────
console.log("\n═══ NSGA-II ═══");
const { runNSGA2 } = await import("../src/utils/nsga2.ts");

const tNsga = Date.now();
const nsgaResult = await runNSGA2(reachableLocs, home, config, effective);
console.log(`⏱ ${Date.now() - tNsga}ms`);

const best = nsgaResult.balanced || nsgaResult.minDistance;
if (best) {
  console.log(`Days: ${best.days}, Distance: ${best.totalDistance?.toFixed(1)}km`);
  const nsgaPOIs = new Set();
  for (const d of best.dayRoutes || []) {
    for (const s of d.stops) {
      if (!s.isHome) nsgaPOIs.add(s.name);
    }
  }
  console.log(`POIs assigned: ${nsgaPOIs.size}/${reachableLocs.length}`);
  if (nsgaPOIs.size < reachableLocs.length) {
    const missing = reachableLocs.filter(l => !nsgaPOIs.has(l.name));
    for (const m of missing) console.log(`  ❌ Missing: ${m.name}`);
  }
}

console.log(`\n📋 Summary: ${reachable}/${locations.length} reachable · CW: ${cwPOIs.size}/${reachableLocs.length} · NSGA-II: ${nsgaPOIs?.size ?? "?"}/${reachableLocs.length}`);
