/**
 * The arithmetic half of the sound analyser — pure, so it's tested without a
 * model or a network (tests/sound-model.test.ts).
 *
 * CLAP hears a preview and returns 512 numbers. Clients get 32: a projection
 * fitted once over the catalogue (PCA, the 32 directions songs differ along
 * most) and stored in sound-calibration.json, so every later run projects new
 * songs into the same space. Mood readings are calibrated the same way:
 * CLAP scores every song as somewhat "party" because of how the prompt is
 * worded, so each mood is z-scored against the catalogue before they compete.
 */

export const MOOD_ORDER = ["hyped", "party", "sunny", "chill", "tender", "sleepy"];

/** Several wordings per mood, averaged, so no single phrasing decides it. */
export const MOOD_PROMPTS = {
  hyped: ["hype music with a hard, aggressive beat", "high energy pump-up workout music", "intense, loud, driving music"],
  party: ["party dance music", "club music with a big dance beat", "celebration music for a crowded room"],
  sunny: ["happy upbeat feel-good song", "bright, cheerful, sunny music", "joyful music that makes you smile"],
  chill: ["calm relaxed chill music", "laid-back mellow background music", "smooth easy-going music"],
  tender: ["sad emotional song", "heartbreak ballad", "tender, melancholic, emotional music"],
  sleepy: ["sleepy soft quiet lullaby", "slow ambient music for falling asleep", "very quiet gentle calm music"],
};
export const VOCAL_PROMPTS = ["a song with a person singing vocals", "a singer's voice with music"];
export const INSTRUMENTAL_PROMPTS = ["instrumental music with no vocals", "music with no singing at all"];

export const DIMS = 32;

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
export function unit(v) {
  const n = Math.sqrt(dot(v, v));
  return n > 1e-12 ? v.map((x) => x / n) : v.map(() => 0);
}
export function mean(rows) {
  const out = new Array(rows[0].length).fill(0);
  for (const r of rows) for (let i = 0; i < r.length; i++) out[i] += r[i];
  return out.map((x) => x / rows.length);
}

/**
 * The top `k` principal directions of `rows` (already centred), by power
 * iteration with deflation. Deterministic: the start vector is fixed, so the
 * same catalogue always yields the same projection.
 */
export function principalComponents(rows, k, iterations = 60) {
  const d = rows[0].length;
  const comps = [];
  for (let c = 0; c < k; c++) {
    let v = unit(Array.from({ length: d }, (_, i) => Math.sin(i * 12.9898 + c * 78.233) + 1e-3));
    for (let it = 0; it < iterations; it++) {
      const xv = rows.map((r) => dot(r, v));
      const next = new Array(d).fill(0);
      rows.forEach((r, n) => {
        for (let i = 0; i < d; i++) next[i] += r[i] * xv[n];
      });
      // remove what earlier components already explain
      for (const p of comps) {
        const along = dot(next, p);
        for (let i = 0; i < d; i++) next[i] -= along * p[i];
      }
      v = unit(next);
    }
    comps.push(v);
  }
  return comps;
}

/** 512 → 32 with the fitted projection, unit length. */
export function project(embedding, calibration) {
  const centred = embedding.map((x, i) => x - calibration.mean[i]);
  return unit(calibration.components.map((p) => dot(centred, p)));
}

/** 32 floats in -1..1 → 32 signed bytes → base64 (44 chars). */
export function packSound(vec) {
  const bytes = Uint8Array.from(vec.map((x) => (Math.max(-127, Math.min(127, Math.round(x * 127))) + 256) % 256));
  return Buffer.from(bytes).toString("base64");
}

export function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** Per-mood mean and spread of the raw scores across the catalogue. */
export function fitMoodStats(rawRows) {
  const mu = mean(rawRows);
  const sd = mu.map((m, i) => {
    const v = rawRows.reduce((s, r) => s + (r[i] - m) ** 2, 0) / rawRows.length;
    return Math.max(Math.sqrt(v), 1e-4);
  });
  return { mean: mu, std: sd };
}

/**
 * Raw CLAP mood scores → a distribution over the six moods. Each mood is first
 * judged against how the whole catalogue scored on it, so "party" winning
 * because every song half-matches the word "dance" stops happening.
 */
export function calibrateMoods(raw, stats, sharpness = 1.4) {
  const z = raw.map((x, i) => (x - stats.mean[i]) / stats.std[i]);
  return softmax(z.map((x) => x * sharpness)).map((p) => Math.round(p * 1000) / 1000);
}

/** Sung vs instrumental, 0..1, relative to the catalogue. */
export function calibrateVocal(raw, stats) {
  const z = (raw - stats.mean) / stats.std;
  return Math.round((1 / (1 + Math.exp(-1.5 * z))) * 1000) / 1000;
}
