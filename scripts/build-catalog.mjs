/**
 * Build the deck catalogue from Apple's live charts, with real hooks.
 *
 * Two problems this solves at once:
 *
 * 1. The catalogue was 118 songs baked into the JS bundle. This pulls the
 *    current charts across countries and genres instead, and writes JSONL for
 *    `npx convex import`, so the deck can grow without growing the bundle.
 *
 * 2. Every track gets three hooks rather than one 30-second block. The windows
 *    come from lib/hook-detector.mjs â€” loudness, transients AND phrase-level
 *    repetition, so choruses lead â€” and are also baked into both clients'
 *    src/data/catalog.json (see --bake), so a cold start plays measured hooks
 *    instead of "the whole preview from 0s".
 *
 * Usage:
 *   node scripts/build-catalog.mjs --limit 1000 [--no-audio] [--out ./dir] [--bake 100]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeUrl } from "./lib/hook-detector.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = dirname(here);
const repo = dirname(web);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const LIMIT = Number(flag("limit", 1000));
const ANALYSE = !args.includes("--no-audio");
const OUT = flag("out", join(web, "catalog-out"));
const BAKE = Number(flag("bake", 100)); // 0 disables the client catalogs

// Charts are per storefront, so spreading the countries is what keeps the deck
// from being one market's top 40. India and the Gulf are deliberate â€” that's
// who this is being built for first.
const COUNTRIES = ["in", "us", "gb", "ae", "sa", "ca", "au", "ng", "kr", "br"];

// 0 is the all-genres feed; the rest stop the charts collapsing into pop.
const GENRES = [0, 14, 21, 18, 17, 20, 15, 6, 7, 19];

const ACCENTS = [
  "#ff3d71", "#00e5a0", "#ffb627", "#7c5cff",
  "#ff6b6b", "#3ddc97", "#4dabf7", "#f783ac",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/**
 * fetch with a deadline. Nine of the hundred chart feeds don't answer at all
 * (a genre a storefront doesn't carry), and without this one of them holds a
 * worker slot open forever.
 */
const get = (url, ms = 20000) => fetch(url, { signal: AbortSignal.timeout(ms) });

/** Run the list through `worker` with at most `n` in flight. */
async function pool(items, n, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          out[i] = await worker(items[i], i);
        } catch {
          out[i] = null;
        }
      }
    }),
  );
  return out;
}

// ------------------------------------------------------------------ charts

async function chartIds() {
  const feeds = [];
  for (const country of COUNTRIES) {
    for (const genre of GENRES) {
      const g = genre === 0 ? "" : "genre=" + genre + "/";
      feeds.push({
        country,
        url: "https://itunes.apple.com/" + country + "/rss/topsongs/limit=100/" + g + "json",
      });
    }
  }
  log("fetching " + feeds.length + " chart feeds...");

  const ids = new Map(); // id -> how many charts it shows up in
  // Which storefronts a song charts in is the only language signal these feeds
  // carry. Apple's genre taxonomy is mostly Western â€” an entire Bollywood chart
  // comes back as "worldwide" â€” so charting in `in` is what tells us a track is
  // likely Hindi, and `sa`/`ae` Arabic.
  const markets = new Map();
  const answered = await pool(feeds, 8, async ({ url, country }) => {
    const res = await get(url);
    if (!res.ok) return 0;
    const json = await res.json();
    const entries = json && json.feed && json.feed.entry;
    if (!Array.isArray(entries)) return 0;
    for (const e of entries) {
      const id = e && e.id && e.id.attributes && e.id.attributes["im:id"];
      if (!id) continue;
      ids.set(id, (ids.get(id) ?? 0) + 1);
      const seen = markets.get(id) ?? new Set();
      seen.add(country);
      markets.set(id, seen);
    }
    return entries.length;
  });

  log("  " + answered.filter(Boolean).length + "/" + feeds.length +
      " feeds answered, " + ids.size + " unique ids");
  // Charting in several countries at once is the closest thing to a popularity
  // signal these feeds give, so lead with those.
  return {
    ids: [...ids.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    markets,
  };
}

// ------------------------------------------------------------------ lookup

async function lookup(ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  log("looking up " + ids.length + " tracks in " + batches.length + " batches...");

  const all = [];
  for (const [i, batch] of batches.entries()) {
    const res = await get(
      "https://itunes.apple.com/lookup?id=" + batch.join(",") + "&entity=song",
      30000,
    );
    if (res.ok) {
      const json = await res.json();
      for (const r of json.results ?? []) {
        if (r.wrapperType === "track" && r.previewUrl && r.artworkUrl100) all.push(r);
      }
    }
    if (i % 5 === 4) log("  " + all.length + " usable so far...");
    await sleep(1200); // lookup is generous, but not free
  }
  return all;
}

// ------------------------------------------------------------------ audio

// Audio analysis lives in lib/hook-detector.mjs, shared with
// scripts/analyze-hooks.mjs so the CLI and this builder can never drift.

// ------------------------------------------------------------------ main

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const { ids, markets } = await chartIds();
const raw = await lookup(ids.slice(0, Math.ceil(LIMIT * 1.35)));

const seen = new Set();
const picked = [];
for (const r of raw) {
  const key = (r.artistName + "|" + r.trackName).toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  picked.push(r);
  if (picked.length >= LIMIT) break;
}
log(picked.length + " tracks after dedupe");

let analysed = 0;
if (ANALYSE) log("measuring loudness, transients and repetition (ffmpeg, 8 at a time)...");
const withHooks = await pool(picked, 8, async (r) => {
  const windows = ANALYSE
    ? await analyzeUrl(r.previewUrl, r.trackTimeMillis ?? 30000).catch(() => null)
    : null;
  if (windows) {
    analysed++;
    if (analysed % 100 === 0) log("  analysed " + analysed + "...");
  }
  // fall back to even thirds when the audio can't be fetched or decoded
  const hooks =
    windows ??
    ((() => {
      const total = 30000;
      const windowMs = Math.min(15000, Math.floor(total / 3));
      const stride = Math.floor((total - windowMs) / 2);
      return [0, 1, 2].map((i) => ({
        startMs: i * stride,
        durationMs: windowMs,
        score: 0,
      }));
    })());
  return { r, hooks };
});

const tracks = [];
const hooks = [];
for (const entry of withHooks.filter(Boolean)) {
  const r = entry.r;
  const trackId = String(r.trackId);
  tracks.push({
    trackId,
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName ?? "",
    artwork: r.artworkUrl100.replace(/100x100bb/, "600x600bb"),
    previewUrl: r.previewUrl,
    durationMs: r.trackTimeMillis ?? 0,
    genre: (r.primaryGenreName ?? "pop").toLowerCase(),
    accent: ACCENTS[hash(trackId) % ACCENTS.length],
    origin: "curated",
    markets: [...(markets.get(trackId) ?? [])],
  });
  entry.hooks.forEach((w, order) => {
    hooks.push({
      trackId,
      startMs: w.startMs,
      durationMs: w.durationMs,
      order,
      active: true,
      createdBy: "system:catalog",
      source: "curated",
    });
  });
}

mkdirSync(OUT, { recursive: true });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(join(OUT, "tracks.jsonl"), jsonl(tracks));
writeFileSync(join(OUT, "hooks.jsonl"), jsonl(hooks));

// ---- cold-start catalogs for the two clients ------------------------------
//
// The baked list is what a brand-new visitor swipes before tracks.list has
// ever answered — and until now it carried no hooks at all, so the very first
// session ignored everything above. Baked hook ids are synthetic ("<id>:<n>"),
// which the clients treat as opaque; only server hook ids are ever credited.
if (BAKE > 0) {
  const hooksByTrack = new Map();
  for (const h of hooks) {
    const list = hooksByTrack.get(h.trackId) ?? [];
    list.push(h);
    hooksByTrack.set(h.trackId, list);
  }
  const clientCatalog = tracks.slice(0, BAKE).map((t) => ({
    id: t.trackId,
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: t.artwork,
    previewUrl: t.previewUrl,
    durationMs: t.durationMs,
    genre: t.genre,
    accent: t.accent,
    markets: t.markets,
    hooks: (hooksByTrack.get(t.trackId) ?? []).map((h, i) => ({
      id: `${t.trackId}:${i}`,
      startMs: h.startMs,
      durationMs: h.durationMs,
    })),
  }));
  const pretty = JSON.stringify(clientCatalog, null, 1) + "\n";
  writeFileSync(join(web, "src", "data", "catalog.json"), pretty);
  writeFileSync(join(repo, "mobile", "src", "data", "catalog.json"), pretty);
}

log("");
log("tracks : " + tracks.length);
log("hooks  : " + hooks.length + "  (" + analysed + " scored by the detector, " +
    (tracks.length - analysed) + " evenly)");
log("written: " + OUT + (BAKE > 0 ? ` + ${Math.min(BAKE, tracks.length)} baked to both clients` : ""));
