import type { Track } from "../types";

/**
 * What a song sounds like, and what this listener's ear leans toward.
 *
 * Every track the offline analyser has heard carries `sound`: its CLAP audio
 * embedding (512 numbers from a model that listened to the preview), projected
 * to 32 and packed as signed bytes in base64 — 44 characters a song. Songs
 * that sound alike point the same way.
 *
 * A listener's taste vector is the direction their keeps point in, minus where
 * their buries point: 32 numbers, built on the device from swipes it already
 * holds, never sent anywhere. Scoring a card is one dot product. That is the
 * whole "personal model that takes no space": the heavy part (listening) is
 * done once per song, offline, for everyone; the personal part is a vector.
 *
 * It complements rather than replaces predict.ts, which learns from labels
 * (genre, artist, market). Labels can't tell two "pop" songs apart; this can.
 *
 * Mirrored in mobile/src/data/sound.ts — the two clients must rank alike.
 */

export const SOUND_DIMS = 32;

/** How far a sound match may pull a card forward, in places, at full confidence. */
export const SOUND_PLACES = 10;

/** Keeps weighed against buries and skips, same scale as predict.ts. */
const SKIP_WEIGHT = 0.3;
const BURY_WEIGHT = 1;
/** How hard the dislikes push the other way, relative to the likes. */
const NEGATIVE_PULL = 0.6;
/** Examples before the vector is trusted fully. */
const CONFIDENT_AT = 20;
const PER_CLASS_CAP = 150;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX: Record<string, number> = Object.fromEntries(
  [...B64].map((c, i) => [c, i]),
);

/** base64 → bytes, without atob (not guaranteed on every JS engine the phone runs). */
function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64_INDEX[clean[i]] ?? 0;
    const b = B64_INDEX[clean[i + 1]] ?? 0;
    const c = B64_INDEX[clean[i + 2]] ?? 0;
    const d = B64_INDEX[clean[i + 3]] ?? 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out;
}

function normalise(v: Float32Array): Float32Array | null {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!(n > 1e-9)) return null;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

const decoded = new Map<string, Float32Array | null>();

/** A track's sound vector (unit length), or null if it hasn't been analysed. */
export function soundOf(track: Pick<Track, "sound">): Float32Array | null {
  const raw = track.sound;
  if (!raw) return null;
  const hit = decoded.get(raw);
  if (hit !== undefined) return hit;
  const bytes = fromBase64(raw);
  let vec: Float32Array | null = null;
  if (bytes.length === SOUND_DIMS) {
    const v = new Float32Array(SOUND_DIMS);
    for (let i = 0; i < SOUND_DIMS; i++) v[i] = (bytes[i] > 127 ? bytes[i] - 256 : bytes[i]) / 127;
    vec = normalise(v);
  }
  if (decoded.size > 5000) decoded.clear();
  decoded.set(raw, vec);
  return vec;
}

export interface SoundTaste {
  /** unit vector: the direction their ear leans */
  vector: Float32Array;
  /** 0..1, how much evidence stands behind it */
  confidence: number;
}

export interface SoundHistory {
  saved: Track[];
  buried: string[];
  skipped: string[];
  catalog: Track[];
}

/**
 * The listener's taste vector, from the history the device already keeps.
 * Null until at least one kept song has been analysed — a vector built only
 * from dislikes says what to avoid, not where to go.
 */
export function soundTaste(history: SoundHistory): SoundTaste | null {
  const byId = new Map(history.catalog.map((t) => [t.id, t]));
  const pos = new Float32Array(SOUND_DIMS);
  const neg = new Float32Array(SOUND_DIMS);
  let posW = 0;
  let negW = 0;
  let examples = 0;
  const seen = new Set<string>();

  let kept = 0;
  for (const t of history.saved) {
    if (kept >= PER_CLASS_CAP || seen.has(t.id)) continue;
    seen.add(t.id);
    const v = soundOf(t) ?? soundOf(byId.get(t.id) ?? {});
    if (!v) continue;
    for (let i = 0; i < SOUND_DIMS; i++) pos[i] += v[i];
    posW += 1;
    kept++;
    examples++;
  }
  if (posW === 0) return null;

  let dropped = 0;
  const addNeg = (id: string, w: number) => {
    if (dropped >= PER_CLASS_CAP || seen.has(id)) return;
    seen.add(id);
    const t = byId.get(id);
    const v = t ? soundOf(t) : null;
    if (!v) return;
    for (let i = 0; i < SOUND_DIMS; i++) neg[i] += v[i] * w;
    negW += w;
    dropped++;
    examples++;
  };
  for (const id of history.buried) addNeg(id, BURY_WEIGHT);
  for (const id of history.skipped) addNeg(id, SKIP_WEIGHT);

  const vec = new Float32Array(SOUND_DIMS);
  for (let i = 0; i < SOUND_DIMS; i++) {
    vec[i] = pos[i] / posW - (negW > 0 ? (NEGATIVE_PULL * neg[i]) / negW : 0);
  }
  const unit = normalise(vec);
  if (!unit) return null;
  return { vector: unit, confidence: Math.min(1, examples / CONFIDENT_AT) };
}

/** How well a track's sound matches the taste vector, -1..1; 0 when unknown. */
export function soundScore(taste: SoundTaste | null, track: Pick<Track, "sound">): number {
  if (!taste) return 0;
  const v = soundOf(track);
  if (!v) return 0;
  let dot = 0;
  for (let i = 0; i < SOUND_DIMS; i++) dot += v[i] * taste.vector[i];
  return dot;
}

/** Cosine similarity between two tracks' sounds, or null if either is unknown. */
export function soundsLike(a: Pick<Track, "sound">, b: Pick<Track, "sound">): number | null {
  const va = soundOf(a);
  const vb = soundOf(b);
  if (!va || !vb) return null;
  let dot = 0;
  for (let i = 0; i < SOUND_DIMS; i++) dot += va[i] * vb[i];
  return dot;
}
