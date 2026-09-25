/**
 * Hook detection from raw audio — the shared brain.
 *
 * Used by two tools:
 *   - scripts/build-catalog.mjs (chart pull → catalogue with hooks)
 *   - scripts/analyze-hooks.mjs (measures whatever is already in Convex)
 *
 * What "the hook" means here, honestly: a 30-second preview is a tenth of a
 * song, so this finds the most *catchy-feeling* stretch of what exists. Three
 * measured signals, combined:
 *
 *   loudness   — the chorus of a produced track is the loudest part of it
 *   onset rate — hooks are busy; intros and fades are not
 *   repetition — the defining property of a hook is that it REPEATS: a window
 *                whose feature sequence re-appears a few seconds later is
 *                inside a chorus, while one that never echoes itself is a
 *                bridge or an intro. Computed as cosine similarity between
 *                the window's band-energy frames and the same frames shifted
 *                by every phrase-length lag (4–12s).
 *
 * No FFT and no dependencies: three one-pole filters give low/mid/high bands,
 * which is plenty to spot "this segment comes round again".
 */

/** 22.05kHz keeps transients findable; 8kHz throws hi-hats away entirely. */
export const SR = 22050;
const HOP = 256;

import { spawn } from "node:child_process";

/**
 * Pipe encoded audio through ffmpeg and collect mono PCM.
 *
 * spawn rather than execFile on purpose: execFile has no `input` option (that
 * belongs to execFileSync), so passing one is silently ignored and ffmpeg sits
 * forever on a stdin that never closes — nothing errors, nothing finishes.
 */
export function decodeAudio(audio, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", [
      "-v", "error", "-i", "pipe:0",
      "-ac", "1", "-ar", String(SR), "-f", "s16le", "-",
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
    }, timeoutMs);

    ff.stdout.on("data", (c) => chunks.push(c));
    ff.on("error", () => done(null));
    ff.on("close", () => done(Buffer.concat(chunks)));
    ff.stdin.on("error", () => {}); // a rejected pipe is the close path, not a crash
    ff.stdin.end(audio);
  });
}

/** Per-frame low/mid/high RMS + the positive-difference onset envelope. */
function features(pcm) {
  const frames = Math.floor(pcm.length / HOP);
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);
  let lp = 0, lp2 = 0;
  for (let f = 0; f < frames; f++) {
    let l = 0, m = 0, h = 0;
    const end = Math.min((f + 1) * HOP, pcm.length);
    for (let i = f * HOP; i < end; i++) {
      const x = pcm[i] / 32768;
      lp += 0.05 * (x - lp); // roughly below 200Hz
      lp2 += 0.35 * (x - lp2); // roughly below 2kHz
      l += lp * lp;
      m += (lp2 - lp) * (lp2 - lp);
      h += (x - lp2) * (x - lp2);
    }
    const n = Math.max(1, end - f * HOP);
    low[f] = Math.sqrt(l / n);
    mid[f] = Math.sqrt(m / n);
    high[f] = Math.sqrt(h / n);
  }

  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    env[f] =
      Math.max(0, low[f] - low[f - 1]) +
      Math.max(0, mid[f] - mid[f - 1]) +
      1.5 * Math.max(0, high[f] - high[f - 1]);
  }
  let max = 0;
  for (const v of env) max = Math.max(max, v);
  if (max > 0) for (let i = 0; i < frames; i++) env[i] /= max;

  return { low, mid, high, env, frames };
}

/** RMS per whole second — the coarse loudness curve. */
export function loudnessPerSecond(pcm) {
  const seconds = Math.floor(pcm.length / SR);
  const rms = [];
  for (let s = 0; s < seconds; s++) {
    let sum = 0;
    for (let i = s * SR; i < (s + 1) * SR; i++) sum += pcm[i] * pcm[i];
    rms.push(Math.sqrt(sum / SR));
  }
  return rms;
}

export function onsetEnvelope(pcm) {
  return features(pcm).env;
}

/** The strongest onset near `targetMs`, preferring ones that barely move. */
export function snapToOnset(env, targetMs, windowMs = 1200) {
  const fps = SR / HOP;
  const centre = Math.round((targetMs / 1000) * fps);
  const reach = Math.round((windowMs / 1000) * fps);
  let best = -1;
  let bestScore = 0;
  for (let i = Math.max(1, centre - reach); i < Math.min(env.length, centre + reach); i++) {
    const score = env[i] * (1 - 0.6 * (Math.abs(i - centre) / reach));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best < 0 ? targetMs : Math.round((best / fps) * 1000);
}

/** Where the audio stops being worth listening to (previews fade out). */
export function usableEnd(rms) {
  if (!rms || rms.length === 0) return null;
  const sorted = [...rms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const floor = median * 0.3;
  for (let i = rms.length - 1; i >= 0; i--) {
    if (rms[i] > floor) return (i + 1) * 1000;
  }
  return null;
}

// ------------------------------------------------------------------ measure

/**
 * Decode + measure everything the scorer needs, in one pass over the audio.
 */
export async function measureAudio(encodedAudio, fallbackMs) {
  const stdout = await decodeAudio(encodedAudio);
  if (!stdout || stdout.length < 16000) return null;

  const pcm = new Int16Array(
    stdout.buffer,
    stdout.byteOffset,
    Math.floor(stdout.length / 2),
  );
  const { low, mid, high, env } = features(pcm);
  return {
    rms: loudnessPerSecond(pcm),
    onsets: env,
    bands: { low, mid, high },
    durationMs: Math.round((pcm.length / SR) * 1000),
    fallbackMs: fallbackMs ?? 30000,
  };
}

/**
 * Repetition score for the window starting at `startS` seconds, length L
 * seconds: how strongly its band-energy shape echoes one phrase away. A window
 * inside a chorus scores high — the chorus comes back. An intro or bridge never
 * repeats within earshot and scores low.
 *
 * Two things the first version got wrong, both of which piled hooks up at the
 * edges of the preview:
 *  - it only looked FORWARD for the echo, so a window near the end had no lag
 *    left to test and a window at 0 was refused outright. A chorus that closes
 *    the preview repeats what came before it; both directions count now.
 *  - it compared raw band energies. Every frame of mastered music is positive
 *    and about equally loud, so two unrelated passages scored ~0.75 against a
 *    true repeat's 1.0. Centring each band on the window's own mean makes it a
 *    correlation: unrelated passages sit near 0.
 */
function repetitionScore(profile, startS, L) {
  const { bands } = profile;
  const hopS = HOP / SR;
  const frames = bands.low.length;
  const from = Math.max(0, Math.floor(startS / hopS));
  const len = Math.max(4, Math.floor(L / hopS));
  if (from + len > frames) return 0;

  const mean = (arr, a) => {
    let s = 0, n = 0;
    for (let i = 0; i < len; i += 4) { s += arr[a + i]; n++; }
    return n ? s / n : 0;
  };
  const mA = [mean(bands.low, from), mean(bands.mid, from), mean(bands.high, from)];

  let best = 0;
  for (let lagS = 4; lagS <= 12; lagS += 1) {
    for (const dir of [1, -1]) {
      const at = from + dir * Math.round(lagS / hopS);
      if (at < 0 || at + len > frames) continue;
      const mB = [mean(bands.low, at), mean(bands.mid, at), mean(bands.high, at)];
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < len; i += 4) { // sampled — precision is irrelevant here
        const a = [bands.low[from + i] - mA[0], bands.mid[from + i] - mA[1], bands.high[from + i] - mA[2]];
        const b = [bands.low[at + i] - mB[0], bands.mid[at + i] - mB[1], bands.high[at + i] - mB[2]];
        dot += a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        na += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
        nb += b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
      }
      if (na === 0 || nb === 0) continue;
      best = Math.max(best, dot / Math.sqrt(na * nb));
    }
  }
  return Math.max(0, best);
}

/** Scale a list of numbers onto 0..1 (all-equal lists become all 0.5). */
function spread(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => (hi - lo > 1e-9 ? (v - lo) / (hi - lo) : 0.5));
}

/**
 * Pick up to `count` windows out of measured audio, catchiest first.
 *
 * Why this was rewritten: a preview is ~30 s and the windows are ~10 s, and the
 * first version insisted on `count` windows that never overlapped. Three
 * ten-second windows that can't overlap only fit in a thirty-second clip one
 * way — 0, 10, 20 — so "measured" hooks were even thirds with a second of
 * jitter, and one of the three was always the intro. Now:
 *
 *  - windows may overlap by up to half, so two good starting points inside one
 *    long chorus are both allowed;
 *  - a window is only kept if it scores within reach of the best one — a quiet
 *    intro is no longer promoted to hook #3 just to fill the quota;
 *  - three measured signals, each spread onto 0..1 across this track's own
 *    candidates so that each one actually discriminates:
 *      loudness   mean level of the window (the chorus of a produced track is
 *                 its loudest part)
 *      repetition does this passage come round again a phrase away
 *      entry      a rise in level into the window — where a chorus lands
 *  - and a window whose tail is fading out is marked down, because a hook
 *    that dies in the preview's fade is a bad first impression.
 */
export function planHooks(profile, count = 3) {
  const MIN_HOOK_MS = 6000;
  const MAX_HOOK_MS = 15000;
  const STEP_MS = 500;
  const KEEP_RATIO = 0.6;

  const raw = profile?.durationMs || profile?.fallbackMs || 30000;
  const trimmed = usableEnd(profile?.rms);
  // never trim more than a quarter away
  const total = trimmed && trimmed > raw * 0.75 ? trimmed : raw;
  if (!total || total < MIN_HOOK_MS * 2) {
    return [{ startMs: 0, durationMs: Math.max(total || 30000, MIN_HOOK_MS), score: 0 }];
  }
  const windowMs = Math.min(MAX_HOOK_MS, Math.floor(total / count));
  if (windowMs < MIN_HOOK_MS) return [{ startMs: 0, durationMs: total, score: 0 }];

  const rms = profile?.rms ?? [];
  const sorted = [...rms].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const meanOf = (a, b) => {
    const s = rms.slice(Math.max(0, Math.floor(a)), Math.max(0, Math.ceil(b)));
    return s.length ? s.reduce((x, y) => x + y, 0) / s.length : 0;
  };

  const starts = [];
  for (let s = 0; s + windowMs <= total; s += STEP_MS) starts.push(s);
  const loud = starts.map((s) => meanOf(s / 1000, (s + windowMs) / 1000));
  const rep = starts.map((s) => (profile?.bands ? repetitionScore(profile, s / 1000, windowMs / 1000) : 0));
  // entry: how much louder the first 3 s are than the 3 s before. Nothing
  // precedes 0, so the opening window is scored neutral rather than punished.
  const entryRaw = starts.map((s) =>
    s >= 2000 ? meanOf(s / 1000, s / 1000 + 3) - meanOf(s / 1000 - 3, s / 1000) : null,
  );
  const known = entryRaw.filter((v) => v !== null);
  const entryScaled = known.length ? spread(known) : [];
  let k = 0;
  const entry = entryRaw.map((v) => (v === null ? 0.5 : entryScaled[k++]));
  const loudN = spread(loud);
  const repN = spread(rep);

  const candidates = starts.map((s, i) => {
    const endS = (s + windowMs) / 1000;
    const tail = meanOf(endS - 2, endS);
    const fading = median > 0 && tail < median * 0.5 ? 0.35 : 0;
    return {
      startMs: s,
      durationMs: windowMs,
      score: 0.4 * loudN[i] + 0.35 * repN[i] + 0.25 * entry[i] - fading,
    };
  });
  candidates.sort((a, b) => b.score - a.score);

  // greedy pick: at least half a window apart, and only while still good
  const minGap = Math.floor(windowMs / 2);
  const bestScore = candidates[0]?.score ?? 0;
  const picked = [];
  for (const c of candidates) {
    if (picked.length > 0 && c.score < bestScore * KEEP_RATIO) break;
    if (picked.every((p) => Math.abs(p.startMs - c.startMs) >= minGap)) {
      picked.push(c);
      if (picked.length >= count) break;
    }
  }
  if (picked.length === 0) picked.push({ startMs: 0, durationMs: windowMs, score: 0 });

  // put each start on a transient rather than an arbitrary tick of the clock
  if (profile?.onsets) {
    for (const w of picked) {
      const snapped = snapToOnset(profile.onsets, w.startMs);
      if (snapped >= 0 && snapped + w.durationMs <= raw) w.startMs = snapped;
    }
  }

  // catchiest first — tracks.list re-sorts by save rate once there's data
  return picked.sort((a, b) => b.score - a.score);
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/**
 * How activating this recording sounds, 0..1 — the arousal axis of the mood
 * plane, measured rather than guessed from the genre string.
 *
 * Free, because both curves are already computed to find hooks.
 *
 * Calibrated against 36 real chart previews rather than guessed. The first
 * version mapped -34..-8 dBFS and 70% of the catalogue landed in the loudest
 * band, because commercially mastered music all lives near the top of that
 * range. What the measurements actually showed:
 *
 *   loudness — the median second, in dBFS, is the one feature here that tracks
 *              how activating a song is. Real masters span roughly -21 (a
 *              devotional stotram, a quiet ballad) to -9 (a Tamil mass number,
 *              club electronic), so that is the scale. Median, not mean, so an
 *              intro or one clipped transient doesn't decide it.
 *   rhythm   — onset peaks per second. Weighted lightly because it is mostly
 *              noise as measured: the envelope is normalised per track, so a
 *              quiet recording grows lots of small "peaks" — a chant scored
 *              8.7/s where a hip-hop track scored 2.9/s.
 *
 * The caveat worth knowing: loudness also tracks MASTERING ERA. A 1983 pop
 * single measures quiet because it was mastered in 1983, not because it is
 * calm. That is why energy carries the smallest weight of the three mood
 * signals (see moodFit), and why valence — happy or sad — is not attempted at
 * all; that needs a trained model listening to the audio.
 */
/**
 * Which version of the scale above produced a stored energy. Bump it whenever
 * the mapping changes: the backend keeps the number next to each measurement,
 * and `analyze-hooks.mjs --energy-only` re-measures everything older without
 * touching hooks (re-writing hooks would orphan their play and save counts).
 */
export const ENERGY_CALIBRATION = 2;

export function trackEnergy(profile) {
  const rms = profile?.rms ?? [];
  const env = profile?.onsets ?? [];
  if (rms.length === 0 || env.length === 0) return null;

  const sorted = [...rms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] / 32768;
  const db = 20 * Math.log10(Math.max(median, 1e-5));
  const loud = clamp01((db + 21) / 12); // -21 dBFS reads as 0, -9 as 1

  const fps = SR / HOP;
  let peaks = 0;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > 0.18 && env[i] >= env[i - 1] && env[i] > env[i + 1]) peaks++;
  }
  const busy = clamp01((peaks / (env.length / fps) - 2) / 12);

  return Math.round((0.85 * loud + 0.15 * busy) * 1000) / 1000;
}

/**
 * Download + analyse in one call.
 *
 * Returns the scored windows and the track's measured energy together: one
 * download, one decode, two answers. Null only when the audio never arrived.
 */
export async function analyzeUrl(url, fallbackMs = 30000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) return null;
  const audio = Buffer.from(await res.arrayBuffer());
  const profile = await measureAudio(audio, fallbackMs);
  if (!profile) return null;
  return { windows: planHooks(profile, 3), energy: trackEnergy(profile) };
}
