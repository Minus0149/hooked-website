/**
 * Listen to every preview once and write down what it sounds like.
 *
 * For each track: download the 30s preview, decode it, and run CLAP (a model
 * that places audio and text in one space) over three 10-second windows. The
 * averaged embedding becomes the track's `sound` (32 numbers, see
 * src/data/sound.ts); its closeness to a few descriptions of each mood becomes
 * `audioMood`; "singing" vs "instrumental" becomes `vocal`.
 *
 * Free and offline: the model (~150MB) downloads once into ../.models and runs
 * on the CPU, ~1s a track. Nothing is sent anywhere but the results, to the
 * backend, over the same key the hook analyser uses.
 *
 * The first run fits the projection and mood calibration over the catalogue
 * and writes scripts/lib/sound-calibration.json — commit it. Later runs reuse
 * it, so new songs land in the same space. Delete it (and bump nothing else)
 * to refit; the version inside moves on, and every track is re-heard.
 *
 * Embeddings are cached in ../.models/sound-cache.json, so pointing the same
 * run at a second backend (dev, prod) doesn't download anything twice.
 *
 *   HOOK_ANALYZE_KEY=<key> node scripts/analyze-sound.mjs --base https://<deployment>.convex.site
 *   [--limit 2000]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutoProcessor,
  AutoTokenizer,
  ClapAudioModelWithProjection,
  ClapTextModelWithProjection,
  env,
} from "@huggingface/transformers";
import {
  DIMS,
  INSTRUMENTAL_PROMPTS,
  MOOD_ORDER,
  MOOD_PROMPTS,
  VOCAL_PROMPTS,
  calibrateMoods,
  calibrateVocal,
  dot,
  fitMoodStats,
  mean,
  packSound,
  principalComponents,
  project,
  unit,
} from "./lib/sound-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = flag("base", "").replace(/\/+$/, "");
const LIMIT = Number(flag("limit", 2000));
const KEY = process.env.HOOK_ANALYZE_KEY;
const MODEL_DIR = resolve(process.env.HOOKED_MODEL_DIR ?? join(HERE, "../../.models"));
const CAL_PATH = join(HERE, "lib/sound-calibration.json");
const CACHE_PATH = join(MODEL_DIR, "sound-cache.json");
const MODEL_ID = "Xenova/clap-htsat-unfused";
const SR = 48000;
const WINDOW_S = 10;

if (!BASE || !KEY) {
  console.error("usage: HOOK_ANALYZE_KEY=<key> node scripts/analyze-sound.mjs --base https://<deployment>.convex.site");
  process.exit(1);
}
mkdirSync(MODEL_DIR, { recursive: true });
env.cacheDir = MODEL_DIR;

const headers = { "x-analyzer-key": KEY };
let calibration = existsSync(CAL_PATH) ? JSON.parse(readFileSync(CAL_PATH, "utf8")) : null;
const version = calibration?.version ?? 1;
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};

const res = await fetch(`${BASE}/analyzer/sound-pending?limit=${LIMIT}&version=${version}`, { headers });
if (!res.ok) {
  console.error(`pending request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { tracks } = await res.json();
console.log(`${tracks.length} track(s) to hear (sound model v${version})`);
if (tracks.length === 0) process.exit(0);

console.log("loading CLAP…");
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const audioModel = await ClapAudioModelWithProjection.from_pretrained(MODEL_ID, { dtype: "q8" });
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const textModel = await ClapTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: "q8" });

async function embedTexts(texts) {
  const { text_embeds } = await textModel(tokenizer(texts, { padding: true, truncation: true }));
  const d = text_embeds.dims[1];
  return texts.map((_, i) => unit(Array.from(text_embeds.data.slice(i * d, (i + 1) * d))));
}
const moodText = await Promise.all(MOOD_ORDER.map((m) => embedTexts(MOOD_PROMPTS[m])));
const vocalText = await embedTexts(VOCAL_PROMPTS);
const instText = await embedTexts(INSTRUMENTAL_PROMPTS);
const avgSim = (e, group) => group.reduce((s, t) => s + dot(e, t), 0) / group.length;

async function hear(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const dec = spawnSync(
    "ffmpeg",
    ["-v", "error", "-nostdin", "-i", "pipe:0", "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"],
    { input: buf, maxBuffer: 128e6 },
  );
  if (dec.status !== 0 || dec.stdout.length < SR * 4) return null;
  const pcm = new Float32Array(dec.stdout.buffer, dec.stdout.byteOffset, Math.floor(dec.stdout.byteLength / 4));
  const win = SR * WINDOW_S;
  const windows = [];
  for (let start = 0; start + win / 2 <= pcm.length && windows.length < 3; start += win) {
    windows.push(pcm.subarray(start, Math.min(start + win, pcm.length)));
  }
  const embeds = [];
  for (const w of windows) {
    const { audio_embeds } = await audioModel(await processor(w));
    embeds.push(unit(Array.from(audio_embeds.data)));
  }
  return unit(mean(embeds));
}

// ---- listen
let done = 0;
const heard = [];
for (const t of tracks) {
  let emb = cache[t.trackId];
  if (!emb) {
    try {
      emb = await hear(t.previewUrl);
    } catch (err) {
      console.warn(`  ! ${t.trackId}: ${err?.message ?? err}`);
      emb = null;
    }
    if (emb) cache[t.trackId] = emb.map((x) => Math.round(x * 1e5) / 1e5);
  }
  heard.push({ t, emb });
  done++;
  if (done % 25 === 0) {
    console.log(`  ${done}/${tracks.length}`);
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
  }
}
writeFileSync(CACHE_PATH, JSON.stringify(cache));

const withEmb = heard.filter((h) => h.emb);
const rawMood = (e) => moodText.map((group) => avgSim(e, group));
const rawVocal = (e) => avgSim(e, vocalText) - avgSim(e, instText);

// ---- fit once, over the catalogue, then keep it
if (!calibration) {
  if (withEmb.length < 50) {
    console.error(`only ${withEmb.length} tracks heard — need at least 50 to fit the projection`);
    process.exit(1);
  }
  const rows = withEmb.map((h) => h.emb);
  const mu = mean(rows);
  const centred = rows.map((r) => r.map((x, i) => x - mu[i]));
  console.log(`fitting a ${DIMS}-d projection over ${rows.length} tracks…`);
  const components = principalComponents(centred, DIMS);
  const moodStats = fitMoodStats(rows.map(rawMood));
  const vr = rows.map(rawVocal);
  const vm = vr.reduce((a, b) => a + b, 0) / vr.length;
  const vs = Math.max(Math.sqrt(vr.reduce((s, x) => s + (x - vm) ** 2, 0) / vr.length), 1e-4);
  calibration = {
    version,
    model: MODEL_ID,
    fittedOn: rows.length,
    fittedAt: new Date().toISOString(),
    mean: mu.map((x) => Math.round(x * 1e6) / 1e6),
    components: components.map((c) => c.map((x) => Math.round(x * 1e6) / 1e6)),
    moodStats,
    vocalStats: { mean: vm, std: vs },
  };
  writeFileSync(CAL_PATH, JSON.stringify(calibration));
  console.log(`wrote ${CAL_PATH} — commit it`);
}

// ---- post
const results = heard.map(({ t, emb }) =>
  emb
    ? {
        trackId: t.trackId,
        version: calibration.version,
        sound: packSound(project(emb, calibration)),
        audioMood: calibrateMoods(rawMood(emb), calibration.moodStats),
        vocal: calibrateVocal(rawVocal(emb), calibration.vocalStats),
      }
    : { trackId: t.trackId, version: calibration.version },
);
let written = 0;
let heardCount = 0;
for (let i = 0; i < results.length; i += 50) {
  const post = await fetch(`${BASE}/analyzer/sound-ingest`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ batch: results.slice(i, i + 50) }),
  });
  if (!post.ok) {
    console.error(`ingest failed: ${post.status} ${await post.text()}`);
    process.exit(1);
  }
  const out = await post.json();
  written += out.written;
  heardCount += out.heard;
}
console.log(`\nheard ${heardCount}/${tracks.length}; stored ${written}`);

// a taste of the result, so a bad calibration is visible at a glance
const sample = results.filter((r) => r.audioMood).slice(0, 8);
for (const r of sample) {
  const t = tracks.find((x) => x.trackId === r.trackId);
  const top = MOOD_ORDER[r.audioMood.indexOf(Math.max(...r.audioMood))];
  console.log(`  ${top.padEnd(7)} vocal ${r.vocal.toFixed(2)}  ${t.title} — ${t.artist}`);
}
