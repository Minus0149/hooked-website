/**
 * Would this person like this song?
 *
 * The deck already had two ways of guessing. Neither answers the question.
 * `tasteScore` scores a track against three onboarding answers — useful, but
 * it is what somebody *said* about themselves before they had swiped once.
 * `recommend.forMe` scores it against what other listeners did — powerful, and
 * completely silent about a track nobody has reacted to yet, which is every
 * track the nightly chart pull brings in.
 *
 * This is the third: a small model trained on one listener's own behaviour,
 * against features the catalogue already carries. It answers with a
 * probability, so it can be shown as a number and used as a ranking term at the
 * same time.
 *
 * Why logistic regression and not something bigger
 * ------------------------------------------------
 * The interesting models in this space — SASRec, BERT4Rec, and JEPA4Rec, which
 * predicts a target item's *representation* from the context sequence instead
 * of the item itself — are measured on interaction logs of 140k to 300k events.
 * hooked's whole swipe log is three orders of magnitude short of that, and
 * every one of them needs a Python training loop and a GPU that this project
 * does not have and would have to pay for. Run on this much data they overfit
 * and lose to a linear model, which is the well-known shape of the result.
 *
 * So: a regularised logistic regression over sparse categorical features. It
 * trains in single-digit milliseconds on the listener's own device, needs no
 * service, no embedding API and no second database, works offline, works for a
 * signed-out guest, and can say *why* it thinks so — which none of the big
 * models can. When the log reaches six figures, this file is the baseline the
 * replacement has to beat. Until then it is also the best available answer.
 *
 * Nothing here leaves the device. The training set is the listener's own
 * library and buried list, which they already have.
 *
 * Mirrored in mobile/src/data/predict.ts.
 */

import type { Track } from "../types";
import { flattenGenre, GENRES, LANGUAGES } from "./taste";
import { moodById, moodsOf, type CrowdMoods, type MoodId } from "./mood";

export interface TasteModel {
  /** feature key -> log-odds contribution */
  weights: Record<string, number>;
  /** the base rate: what we'd guess knowing nothing about a track */
  bias: number;
  examples: number;
  positives: number;
  negatives: number;
}

export interface Labelled {
  features: string[];
  /** 1 = they kept it, 0 = they did not */
  label: 0 | 1;
  /** how much this row counts; a skip is not a bury */
  weight: number;
}

/* --------------------------------------------------------------- features */

const heatBand = (heat: number) => (heat >= 0.66 ? "hi" : heat >= 0.33 ? "mid" : "lo");

/**
 * A track as a handful of strings.
 *
 * Deliberately coarse and deliberately overlapping. `g:` is the exact genre
 * string, which is precise but splits "hip hop" from "hip-hop/rap"; `b:` is the
 * bucket a person would recognise, which generalises across both. A linear
 * model is happy to hold both and decide for itself which one carried the
 * signal, and that is cheaper than us guessing.
 *
 * What is NOT in here matters too. No track id: a model that learns individual
 * songs can only ever re-recommend what they already have. No album, for the
 * same reason at one remove.
 */
export function featuresOf(track: Track, crowd?: CrowdMoods): string[] {
  const out: string[] = [];
  const genre = flattenGenre(track.genre ?? "");
  if (genre) out.push(`g:${genre}`);

  for (const bucket of GENRES) {
    if (bucket.match.some((m) => genre.includes(flattenGenre(m)))) {
      out.push(`b:${bucket.id}`);
    }
  }

  const artist = (track.artist ?? "").trim().toLowerCase();
  if (artist) out.push(`a:${artist}`);

  for (const market of track.markets ?? []) out.push(`m:${market}`);

  for (const mood of moodsOf(track, crowd?.[track.id], 0.55)) out.push(`mood:${mood}`);

  if (typeof track.heat === "number" && Number.isFinite(track.heat)) {
    out.push(`heat:${heatBand(Math.min(Math.max(track.heat, 0), 1))}`);
  }
  if (typeof track.energy === "number" && Number.isFinite(track.energy)) {
    out.push(`nrg:${heatBand(Math.min(Math.max(track.energy, 0), 1))}`);
  }

  return out;
}

/* --------------------------------------------------------------- training */

export interface TrainOptions {
  epochs: number;
  learningRate: number;
  /** L2 penalty. The only thing stopping one artist from becoming the model. */
  l2: number;
}

export const TRAIN_DEFAULTS: TrainOptions = {
  epochs: 120,
  learningRate: 0.5,
  l2: 0.02,
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/**
 * Batch gradient descent, fully deterministic.
 *
 * No shuffling, no random initialisation, no sampling: the same history trains
 * the same model every time, which is what makes it testable and what stops a
 * "why is this song here" answer from changing between two renders.
 */
export function trainTaste(
  rows: Labelled[],
  options: Partial<TrainOptions> = {},
): TasteModel | null {
  if (rows.length === 0) return null;
  const opts = { ...TRAIN_DEFAULTS, ...options };

  const positives = rows.filter((r) => r.label === 1).length;
  const negatives = rows.length - positives;
  const mass = rows.reduce((n, r) => n + r.weight, 0) || 1;

  const weights: Record<string, number> = {};
  // Start at the base rate rather than at zero, so a model trained on nothing
  // but saves says "probably yes" instead of "no idea" — that IS the evidence.
  const rate = Math.min(Math.max(positives / rows.length, 0.02), 0.98);
  let bias = Math.log(rate / (1 - rate));

  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    const grads: Record<string, number> = {};
    let gBias = 0;
    for (const row of rows) {
      let z = bias;
      for (const f of row.features) z += weights[f] ?? 0;
      const err = (sigmoid(z) - row.label) * row.weight;
      gBias += err;
      for (const f of row.features) grads[f] = (grads[f] ?? 0) + err;
    }
    bias -= (opts.learningRate * gBias) / mass;
    for (const [f, g] of Object.entries(grads)) {
      const w = weights[f] ?? 0;
      weights[f] = w - opts.learningRate * (g / mass + opts.l2 * w);
    }
  }

  return { weights, bias, examples: rows.length, positives, negatives };
}

/* ---------------------------------------------------------------- scoring */

/** Full confidence needs this many examples on the thinner side. */
const CONFIDENT_EACH = 10;

/**
 * How much this model's opinion is worth, 0..1.
 *
 * Gated on the *smaller* class, because a model that has only ever seen songs
 * someone kept cannot tell a good song from a song-shaped object — it will
 * happily return 0.97 for everything. Ranking multiplies by this, and the UI
 * hides the number below it, so the cold-start case costs nothing rather than
 * being confidently wrong.
 */
export function confidence(model: TasteModel | null): number {
  if (!model) return 0;
  return Math.min(1, Math.min(model.positives, model.negatives) / CONFIDENT_EACH);
}

export function scoreFeatures(model: TasteModel | null, features: string[]): number {
  if (!model) return 0.5;
  let z = model.bias;
  for (const f of features) z += model.weights[f] ?? 0;
  return sigmoid(z);
}

/** The probability this listener keeps this song, 0..1. */
export function likeChance(
  model: TasteModel | null,
  track: Track,
  crowd?: CrowdMoods,
): number {
  return scoreFeatures(model, featuresOf(track, crowd));
}

/**
 * The ranking term: -1 .. +1, already damped by confidence.
 *
 * Centred on the base rate rather than on 0.5, so "average for this listener"
 * means no nudge in either direction. Without that, a listener who saves most
 * of what they see would have the whole catalogue pushed forward equally, which
 * is the same as no signal but costs a multiplication.
 */
export function likeBias(
  model: TasteModel | null,
  track: Track,
  crowd?: CrowdMoods,
): number {
  if (!model) return 0;
  const base = sigmoid(model.bias);
  const chance = likeChance(model, track, crowd);
  const spread = chance >= base ? 1 - base : base;
  const centred = spread > 0 ? (chance - base) / spread : 0;
  return centred * confidence(model);
}

/* ------------------------------------------------------------ explanation */

/** Turn a feature key back into something a person would say. */
export function describeFeature(key: string): string | null {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  switch (kind) {
    case "g":
      return null; // the bucket says the same thing in words a person uses
    case "b":
      return GENRES.find((g) => g.id === value)?.label ?? null;
    case "a":
      return value.replace(/\b\w/g, (c) => c.toUpperCase());
    case "m":
      return LANGUAGES.find((l) => l.markets.includes(value))?.label ?? null;
    case "mood":
      return moodById(value as MoodId)?.label.toLowerCase() ?? null;
    case "heat":
      return value === "hi" ? "big right now" : value === "lo" ? "off the charts" : null;
    case "nrg":
      return value === "hi" ? "loud" : value === "lo" ? "quiet" : null;
    default:
      return null;
  }
}

/**
 * The two or three things about this track the model liked most.
 *
 * Only ever positive contributors, and only above a floor: "because it is
 * Punjabi" is a reason, "because it is 0.003 Punjabi" is noise wearing a
 * reason's clothes.
 */
export function reasons(
  model: TasteModel | null,
  track: Track,
  crowd?: CrowdMoods,
  limit = 2,
): string[] {
  if (!model) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const ranked = featuresOf(track, crowd)
    .map((f) => ({ f, w: model.weights[f] ?? 0 }))
    .filter((x) => x.w > 0.08)
    .sort((a, b) => b.w - a.w);
  for (const { f } of ranked) {
    const label = describeFeature(f);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

export interface Verdict {
  chance: number;
  confidence: number;
  reasons: string[];
  /** false when the model has not earned the right to an opinion yet */
  worthShowing: boolean;
}

/** Enough confidence to put a number in front of a person. */
const SHOW_AT = 0.5;

export function verdict(
  model: TasteModel | null,
  track: Track,
  crowd?: CrowdMoods,
): Verdict {
  const conf = confidence(model);
  return {
    chance: likeChance(model, track, crowd),
    confidence: conf,
    reasons: reasons(model, track, crowd),
    worthShowing: conf >= SHOW_AT,
  };
}

/* ------------------------------------------------------- building the set */

export interface HistoryInput {
  /** everything they kept, newest first */
  saved: Track[];
  /** ids they buried, or that the two-skip rule buried for them */
  buried: string[];
  /** ids skipped once and never saved */
  skipped: string[];
  /** where ids are resolved back into tracks */
  catalog: Track[];
  crowd?: CrowdMoods;
}

/**
 * A skip counts, but barely.
 *
 * The deck's own rule is that two skips bury a song, which means a single skip
 * is explicitly *not* a verdict — it is "not right now", the default outcome of
 * looking at a card. Weighting it near a bury would train a model on what
 * someone scrolled past on a Tuesday. Once it happens twice the app has already
 * moved the track into `buried`, where it arrives here at full weight.
 */
const SKIP_WEIGHT = 0.3;

/** Rows per class. Bounds the work and keeps the recent half of a long history. */
const PER_CLASS_CAP = 150;

export function buildExamples(input: HistoryInput): Labelled[] {
  const byId = new Map(input.catalog.map((t) => [t.id, t]));
  const rows: Labelled[] = [];
  const used = new Set<string>();

  const add = (track: Track, label: 0 | 1, weight: number) => {
    if (used.has(track.id)) return;
    used.add(track.id);
    rows.push({ features: featuresOf(track, input.crowd), label, weight });
  };

  // Positives first, so a song they saved after skipping it once is counted as
  // the save it became rather than the skip it was.
  for (const track of input.saved.slice(0, PER_CLASS_CAP)) add(track, 1, 1);

  let negatives = 0;
  for (const id of input.buried) {
    const track = byId.get(id);
    if (!track || negatives >= PER_CLASS_CAP) continue;
    if (!used.has(id)) negatives++;
    add(track, 0, 1);
  }
  for (const id of input.skipped) {
    const track = byId.get(id);
    if (!track || negatives >= PER_CLASS_CAP) continue;
    if (!used.has(id)) negatives++;
    add(track, 0, SKIP_WEIGHT);
  }

  return rows;
}

export function trainFromHistory(
  input: HistoryInput,
  options?: Partial<TrainOptions>,
): TasteModel | null {
  return trainTaste(buildExamples(input), options);
}
