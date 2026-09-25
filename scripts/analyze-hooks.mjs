/**
 * Measure real hooks for every track still waiting for them.
 *
 * Convex can't decode audio, so this runs wherever ffmpeg does (a laptop is
 * fine): it asks the backend for tracks with no measured hooks, downloads each
 * one's preview, finds the catchiest windows (loudness + onset density +
 * phrase-level repetition — see lib/hook-detector.mjs), and posts them back.
 *
 * Provisional even-thirds cover a track until this has run; creator-marked
 * hooks always win over anything computed here.
 *
 * Setup:
 *   npx convex env set HOOK_ANALYZE_KEY "<random-32-bytes>"
 *
 * Usage:
 *   node scripts/analyze-hooks.mjs [--limit 50] [--base https://<deployment>.convex.site]
 *   node scripts/analyze-hooks.mjs --from tracks.jsonl --limit 5000   # re-measure after the finder changes
 *   node scripts/analyze-hooks.mjs --energy-only   # re-measure energy after a recalibration
 *
 * --energy-only asks for tracks whose energy came from an older calibration
 * (ENERGY_CALIBRATION in lib/hook-detector.mjs) and replaces only that number.
 * Hooks are left alone on purpose: rewriting them would orphan their stats.
 */
import { analyzeUrl, ENERGY_CALIBRATION } from "./lib/hook-detector.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE = (flag("base", "https://shocking-goldfinch-745.convex.site")).replace(/\/+$/, "");
const LIMIT = Number(flag("limit", 50));
const KEY = process.env.HOOK_ANALYZE_KEY;
const ENERGY_ONLY = args.includes("--energy-only");

if (!KEY) {
  console.error("Set HOOK_ANALYZE_KEY first (same value as the backend's).");
  console.error("  npx convex env set HOOK_ANALYZE_KEY \"<random-32-bytes>\"");
  process.exit(1);
}

const headers = { "x-analyzer-key": KEY };

// --from <tracks.jsonl> re-measures tracks that were already analysed — after
// the hook finder itself changes. Export the list with
//   npx convex data tracks --prod --limit 20000 --format jsonLines > tracks.jsonl
// Artist-marked hooks survive: the ingest only replaces analyser/system ones.
const FROM = flag("from", null);
let tracks;
if (FROM) {
  const { readFileSync } = await import("node:fs");
  tracks = readFileSync(FROM, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l))
    .filter((t) => t.trackId && t.previewUrl)
    .slice(0, LIMIT);
  console.log(`${tracks.length} track(s) to re-measure from ${FROM}`);
} else {
  const res = await fetch(
    `${BASE}/analyzer/pending?limit=${encodeURIComponent(LIMIT)}` +
      (ENERGY_ONLY ? `&energyCal=${ENERGY_CALIBRATION}` : ""),
    { headers },
  );
  if (!res.ok) {
    console.error(`pending request failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  ({ tracks } = await res.json());
  console.log(
    ENERGY_ONLY
      ? `${tracks.length} track(s) with energy older than calibration ${ENERGY_CALIBRATION}`
      : `${tracks.length} track(s) waiting for analysis`,
  );
}

let done = 0;
let scored = 0;
const results = [];

for (const t of tracks) {
  try {
    const measured = await analyzeUrl(t.previewUrl, t.durationMs || 30000);
    if (ENERGY_ONLY) {
      if (measured) scored++;
      results.push({ trackId: t.trackId, energyOnly: true, energy: measured?.energy ?? null, energyCal: ENERGY_CALIBRATION });
    } else if (measured) {
      scored++;
      results.push({
        trackId: t.trackId,
        analyzedAt: new Date().toISOString(),
        windows: measured.windows.map((w) => ({ startMs: w.startMs, durationMs: w.durationMs })),
        energy: measured.energy,
        energyCal: ENERGY_CALIBRATION,
      });
    } else {
      // mark so we don't retry a dead preview forever
      results.push({ trackId: t.trackId, analyzedAt: new Date().toISOString(), windows: [] });
    }
  } catch (err) {
    console.warn(`  ! ${t.trackId}: ${err?.message ?? err}`);
  }
  done++;
  if (done % 10 === 0) console.log(`  ${done}/${tracks.length}...`);
}

// ingest in batches of 25
for (let i = 0; i < results.length; i += 25) {
  const batch = results.slice(i, i + 25);
  const post = await fetch(`${BASE}/analyzer/ingest`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ batch }),
  });
  if (!post.ok) {
    console.error(`ingest failed: ${post.status} ${await post.text()}`);
    process.exit(1);
  }
  const out = await post.json();
  for (const r of out.results ?? []) {
    if (r.ok) {
      const nrg = r.energy === null || r.energy === undefined ? "" : `, energy ${r.energy}`;
      console.log(`  ✓ ${r.trackId}: ${r.written} hook(s)${nrg}`);
    }
  }
}

console.log(`\nanalysed ${scored}/${tracks.length}; skipped-and-marked ${results.length - scored}`);
