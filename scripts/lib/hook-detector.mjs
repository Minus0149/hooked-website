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
 * seconds: how strongly its band-energy shape echoes at phrase-length lags.
 * A window inside a chorus scores high — the chorus comes back. An intro or
 * bridge never repeats within earshot and scores near zero.
 */
function repetitionScore(profile, startS, L) {
  const { bands } = profile;
  const hopS = HOP / SR;
  const from = Math.floor(startS / hopS);
  const len = Math.max(4, Math.floor(L / hopS)); // ~frames in the window
  if (from <= 0 || from + len >= bands.low.length) return 0;

  let best = 0;
  for (let lagS = 4; lagS <= 12; lagS += 1) {
    const lag = Math.round(lagS / hopS);
    if (from + lag + len >= bands.low.length) continue;
    let dot = 0, na = 0, nb = 0, n = 0;
    for (let i = 0; i < len; i += 4) { // sampled — precision is irrelevant here
      // A = frame at from+i, B = the same frame one phrase later
      const a0 = bands.low[from + i], a1 = bands.mid[from + i], a2 = bands.high[from + i];
      const b0 = bands.low[from + lag + i], b1 = bands.mid[from + lag + i], b2 = bands.high[from + lag + i];
      dot += a0 * b0 + a1 * b1 + a2 * b2;
      na += a0 * a0 + a1 * a1 + a2 * a2;
      nb += b0 * b0 + b1 * b1 + b2 * b2;
      n++;
    }
    if (n === 0 || na === 0 || nb === 0) continue;
    best = Math.max(best, dot / Math.sqrt(na * nb));
  }
  return best;
}

/**
 * Pick `count` distinct windows out of measured audio, catchiest first.
 *
 * Candidates are scored everywhere at one-second steps (not just fixed thirds)
 * and picked greedily with an exclusion neighbourhood, so the winner doesn't
 * simply reappear as the runner-up. Starts snap to transients afterwards.
 */
export function planHooks(profile, count = 3) {
  const MIN_HOOK_MS = 6000;
  const MAX_HOOK_MS = 15000;

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
  const maxRms = rms.length ? Math.max(...rms) : 0;

  const candidates = [];
  for (let s = 0; s + windowMs <= total; s += 1000) {
    const from = Math.floor(s / 1000);
    const to = Math.min(rms.length, Math.ceil((s + windowMs) / 1000));
    const slice = rms.slice(from, to);
    const loud = slice.length
      ? slice.reduce((a, b) => a + b, 0) / slice.length / (maxRms || 1)
      : 0;
    const rep = profile ? repetitionScore(profile, s / 1000, windowMs / 1000) : 0;
    candidates.push({ startMs: s, durationMs: windowMs, score: 0.55 * loud + 0.45 * rep });
  }
  candidates.sort((a, b) => b.score - a.score);

  // greedy pick with exclusion so near-identical neighbours don't win twice
  const picked = [];
  for (const c of candidates) {
    if (picked.every((p) => Math.abs(p.startMs - c.startMs) >= windowMs)) {
      picked.push(c);
      if (picked.length >= count) break;
    }
  }
  while (picked.length < count && picked.length > 0) {
    const last = picked[picked.length - 1];
    const next = Math.min(total - windowMs, last.startMs + windowMs);
    if (next <= last.startMs) break;
    picked.push({ startMs: next, durationMs: windowMs, score: 0 });
  }
  if (picked.length === 0) {
    picked.push({ startMs: 0, durationMs: windowMs, score: 0 });
  }

  // put each start on a transient rather than an arbitrary tick of the clock
  if (profile?.onsets) {
    for (const w of picked) {
      const snapped = snapToOnset(profile.onsets, w.startMs);
      if (snapped >= 0 && snapped + w.durationMs <= raw) w.startMs = snapped;
    }
    picked.sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < picked.length; i++) {
      const prevEnd = picked[i - 1].startMs + picked[i - 1].durationMs;
      if (picked[i].startMs < prevEnd) picked[i].startMs = prevEnd;
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
