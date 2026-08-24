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
 *   node scripts/analyze-hooks.mjs [--limit 50] [--base https://cnx.hookedcue.com]
 */
import { analyzeUrl } from "./lib/hook-detector.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE = (flag("base", "https://cnx.hookedcue.com")).replace(/\/+$/, "");
const LIMIT = Number(flag("limit", 50));
const KEY = process.env.HOOK_ANALYZE_KEY;

if (!KEY) {
  console.error("Set HOOK_ANALYZE_KEY first (same value as the backend's).");
  console.error("  npx convex env set HOOK_ANALYZE_KEY \"<random-32-bytes>\"");
  process.exit(1);
}

const headers = { "x-analyzer-key": KEY };

const res = await fetch(
  `${BASE}/analyzer/pending?limit=${encodeURIComponent(LIMIT)}`,
  { headers },
);
if (!res.ok) {
  console.error(`pending request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { tracks } = await res.json();
console.log(`${tracks.length} track(s) waiting for analysis`);

let done = 0;
let scored = 0;
const results = [];

for (const t of tracks) {
  try {
    const windows = await analyzeUrl(t.previewUrl, t.durationMs || 30000);
    if (windows) {
      scored++;
      results.push({
        trackId: t.trackId,
        analyzedAt: new Date().toISOString(),
        windows: windows.map((w) => ({ startMs: w.startMs, durationMs: w.durationMs })),
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
    if (r.ok) console.log(`  ✓ ${r.trackId}: ${r.written} hook(s)`);
  }
}

console.log(`\nanalysed ${scored}/${tracks.length}; skipped-and-marked ${results.length - scored}`);
