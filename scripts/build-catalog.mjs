/**
 * Build the deck catalogue from Apple's live charts, with real hooks.
 *
 * Two problems this solves at once:
 *
 * 1. The catalogue was 118 songs baked into the JS bundle. This pulls the
 *    current charts across countries and genres instead, and writes JSONL for
 *    `npx convex import`, so the deck can grow without growing the bundle.
 *
 * 2. Every track gets three hooks rather than one 30-second block. A preview is
 *    all we have — Instagram picks three moments out of a full master, we only
 *    get the 30 seconds Apple chose — so the three windows are thirds of that
 *    preview, *ordered by how loud they actually are*. ffmpeg decodes each
 *    preview and the most energetic third leads. That's a guess, but a measured
 *    one, and tracks.list re-sorts by real save rate once a hook has 20 plays,
 *    so the guess only has to survive the first few listeners.
 *
 * Usage:
 *   node scripts/build-catalog.mjs --limit 1000 [--no-audio] [--out ./dir]
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = dirname(here);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const LIMIT = Number(flag("limit", 1000));
const ANALYSE = !args.includes("--no-audio");
const OUT = flag("out", join(web, "catalog-out"));

// Charts are per storefront, so spreading the countries is what keeps the deck
// from being one market's top 40. India and the Gulf are deliberate — that's
// who this is being built for first.
const COUNTRIES = ["in", "us", "gb", "ae", "sa", "ca", "au", "ng", "kr", "br"];

// 0 is the all-genres feed; the rest stop the charts collapsing into pop.
const GENRES = [0, 14, 21, 18, 17, 20, 15, 6, 7, 19];

const ACCENTS = [
  "#ff3d71", "#00e5a0", "#ffb627", "#7c5cff",
  "#ff6b6b", "#3ddc97", "#4dabf7", "#f783ac",
];

const HOOK_COUNT = 3;
const MIN_HOOK_MS = 6000;

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
      feeds.push(
        "https://itunes.apple.com/" + country + "/rss/topsongs/limit=100/" + g + "json",
      );
    }
  }
  log("fetching " + feeds.length + " chart feeds...");

  const ids = new Map(); // id -> how many charts it shows up in
  const answered = await pool(feeds, 8, async (url) => {
    const res = await get(url);
    if (!res.ok) return 0;
    const json = await res.json();
    const entries = json && json.feed && json.feed.entry;
    if (!Array.isArray(entries)) return 0;
    for (const e of entries) {
      const id = e && e.id && e.id.attributes && e.id.attributes["im:id"];
      if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    return entries.length;
  });

  log("  " + answered.filter(Boolean).length + "/" + feeds.length +
      " feeds answered, " + ids.size + " unique ids");
  // Charting in several countries at once is the closest thing to a popularity
  // signal these feeds give, so lead with those.
  return [...ids.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
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

/**
 * Pipe the encoded audio through ffmpeg and collect raw PCM.
 *
 * Written with spawn rather than execFile on purpose: execFile has no `input`
 * option (that belongs to execFileSync), so passing one is silently ignored and
 * ffmpeg sits forever on a stdin that never closes. Nothing errors, nothing
 * finishes.
 */
function decode(audio) {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", [
      "-v", "error", "-i", "pipe:0",
      "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
    ]);
    const chunks = [];
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      ff.kill("SIGKILL");
      done(null);
    }, 20000);

    ff.stdout.on("data", (c) => chunks.push(c));
    ff.on("error", () => done(null));
    ff.on("close", () => done(Buffer.concat(chunks)));
    ff.stdin.on("error", () => {}); // a rejected pipe is the close path, not a crash
    ff.stdin.end(audio);
  });
}

/**
 * Decode the preview to mono 8kHz PCM and measure loudness per second.
 * About 200ms of ffmpeg per song, and nothing touches disk.
 */
async function energyProfile(previewUrl) {
  const res = await get(previewUrl, 25000);
  if (!res.ok) return null;
  const audio = Buffer.from(await res.arrayBuffer());

  const stdout = await decode(audio);
  if (!stdout || stdout.length < 16000) return null;

  const pcm = new Int16Array(
    stdout.buffer,
    stdout.byteOffset,
    Math.floor(stdout.length / 2),
  );
  const seconds = Math.floor(pcm.length / 8000);
  const rms = [];
  for (let s = 0; s < seconds; s++) {
    let sum = 0;
    for (let i = s * 8000; i < (s + 1) * 8000; i++) sum += pcm[i] * pcm[i];
    rms.push(Math.sqrt(sum / 8000));
  }
  return { rms, durationMs: Math.round((pcm.length / 8000) * 1000) };
}

/**
 * Three windows over whatever audio exists, loudest first.
 *
 * Non-overlapping on purpose: these are meant to be three *distinct* parts, so
 * tapping through never replays the same seconds. A 30s preview gives three 10s
 * windows; a longer upload gives three 15s windows spread across it.
 */
/**
 * Where the audio stops being worth listening to.
 *
 * Apple fades every preview out, and across a first run of 1000 songs the final
 * third won the loudness contest exactly zero times — the fade was dragging its
 * average down, and worse, the last hook of every song ended in silence.
 * Trimming to the last moment that still carries real signal fixes both.
 */
function usableEnd(profile) {
  if (!profile || profile.rms.length === 0) return null;
  const sorted = [...profile.rms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const floor = median * 0.3;
  for (let i = profile.rms.length - 1; i >= 0; i--) {
    if (profile.rms[i] > floor) return (i + 1) * 1000;
  }
  return null;
}

function planHooks(profile, fallbackMs) {
  const raw = (profile && profile.durationMs) || fallbackMs;
  const trimmed = usableEnd(profile);
  // never trim more than a quarter of the preview away
  const total = trimmed && trimmed > raw * 0.75 ? trimmed : raw;
  if (!total || total < MIN_HOOK_MS * 2) {
    return [{ startMs: 0, durationMs: Math.max(total || 30000, MIN_HOOK_MS), score: 0 }];
  }

  const windowMs = Math.min(15000, Math.floor(total / HOOK_COUNT));
  if (windowMs < MIN_HOOK_MS) return [{ startMs: 0, durationMs: total, score: 0 }];

  const stride = Math.floor((total - windowMs) / (HOOK_COUNT - 1));
  const windows = Array.from({ length: HOOK_COUNT }, (_, i) => ({
    startMs: i * stride,
    durationMs: windowMs,
    score: 0,
  }));

  if (profile) {
    for (const w of windows) {
      const from = Math.floor(w.startMs / 1000);
      const to = Math.min(profile.rms.length, Math.ceil((w.startMs + w.durationMs) / 1000));
      const slice = profile.rms.slice(from, to);
      w.score = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    }
  }

  // loudest first — tracks.list re-sorts by real save rate once there's data
  return [...windows].sort((a, b) => b.score - a.score);
}

// ------------------------------------------------------------------ main

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const ids = await chartIds();
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
if (ANALYSE) log("measuring loudness (ffmpeg, 8 at a time)...");
const withHooks = await pool(picked, 8, async (r) => {
  const profile = ANALYSE ? await energyProfile(r.previewUrl).catch(() => null) : null;
  if (profile) {
    analysed++;
    if (analysed % 100 === 0) log("  analysed " + analysed + "...");
  }
  return { r, hooks: planHooks(profile, 30000) };
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
      plays: 0,
      saves: 0,
      skips: 0,
    });
  });
}

mkdirSync(OUT, { recursive: true });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(join(OUT, "tracks.jsonl"), jsonl(tracks));
writeFileSync(join(OUT, "hooks.jsonl"), jsonl(hooks));

log("");
log("tracks : " + tracks.length);
log("hooks  : " + hooks.length + "  (" + analysed + " placed by loudness, " +
    (tracks.length - analysed) + " evenly)");
log("written: " + OUT);
