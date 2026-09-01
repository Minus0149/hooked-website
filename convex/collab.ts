/**
 * Learning taste from other people's swipes.
 *
 * Everything ranking the deck until now was self-contained: the answers given
 * at onboarding, the genres right-swiped, how played a track is. All of it
 * describes *categories* — it can tell that someone likes hip-hop, never that
 * these two particular songs go together. That last part is the only thing
 * four gestures per song were ever collected for, and it needs more than one
 * listener to see.
 *
 * This is item–item collaborative filtering over the swipe log: two tracks are
 * neighbours when the same people reacted to them the same way. It is a
 * deliberately plain implementation — cosine similarity on a signed
 * user × track matrix — because the interesting decisions here are not the
 * maths, they are the guards around it:
 *
 *   - A skip is not a dislike. Skips outnumber everything else by an order of
 *     magnitude and most of them mean "not right now"; weighted like a bury
 *     they would drown the signal that matters.
 *   - Nobody's library is a public fact. A pair of tracks stays unpublished
 *     until several separate people have linked it, so no row here can be read
 *     back as one person's taste.
 *   - Prolific listeners do not get a bigger vote. Cosine normalisation is
 *     what stops the person with 800 saves from defining the catalogue.
 *   - Popular tracks do not become everyone's neighbour. The same
 *     normalisation damps them; without it every list would end in the same
 *     five hits.
 *
 * No Convex imports, on purpose — the same reason `matching.ts` has none. This
 * is where the arithmetic lives so it can be tested against fixed inputs
 * without a backend anywhere near it.
 */

export type SwipeAction = "save" | "skip" | "more" | "never";

export type Interaction = {
  userId: string;
  trackId: string;
  action: SwipeAction;
};

/**
 * What each gesture is worth as evidence.
 *
 * `save` is the anchor at 1. `more` is a genuine "yes" that stopped short of
 * keeping the song, so it lands a little under. `never` is nearly as certain
 * as a save in the opposite direction — the listener said the word.
 *
 * `skip` is the one worth arguing about. It is the default outcome of the deck
 * and the honest reading is "wasn't in the mood": treating it as -1 would make
 * the model mostly a study of what people scrolled past. It is kept small and
 * negative so a track skipped by everyone who saved its neighbours still loses
 * ground, without a single skip cancelling a save.
 */
export const ACTION_WEIGHT: Record<SwipeAction, number> = {
  save: 1,
  more: 0.55,
  skip: -0.12,
  never: -0.9,
};

export type CollabOptions = {
  /** Distinct listeners who must have reacted to a track before it can appear. */
  minRaters: number;
  /** Distinct listeners who must link a pair before that pair is published. */
  minSupport: number;
  /** Neighbours kept per track. */
  topK: number;
  /** Most recent reactions considered per listener. */
  perUserCap: number;
  /** Hard ceiling on pair work, so one prolific account can't stall a run. */
  maxPairs: number;
};

export const COLLAB_DEFAULTS: CollabOptions = {
  minRaters: 3,
  minSupport: 2,
  topK: 24,
  perUserCap: 120,
  maxPairs: 2_000_000,
};

/**
 * Joins two track ids into one map key. A track id is whatever the provider
 * called it, which can include spaces and punctuation, so the separator has to
 * be something an id cannot contain.
 */
const PAIR_SEP = "\u0000";

export type Neighbor = { trackId: string; score: number };

export type CollabModel = {
  neighbors: Map<string, Neighbor[]>;
  /** How many tracks cleared `minRaters` and entered the matrix. */
  rated: number;
  /** True when `maxPairs` cut the run short — the model is partial, not wrong. */
  truncated: boolean;
};

/**
 * Fold a swipe log into neighbour lists.
 *
 * Interactions arrive newest-first (that is how the log is read), so the
 * per-listener cap keeps the *recent* half of a long history. Taste moves;
 * three-year-old saves should not outvote last week's.
 */
export function buildNeighbors(
  interactions: Interaction[],
  options: Partial<CollabOptions> = {},
): CollabModel {
  const opts = { ...COLLAB_DEFAULTS, ...options };

  // ---- one signed weight per (listener, track) -------------------------
  // A listener can swipe the same track more than once across sessions —
  // revert-and-redo, or a track that came back round. The most recent verdict
  // is the one that counts, and since the log arrives newest-first that is
  // simply the first one seen.
  const byUser = new Map<string, Map<string, number>>();
  for (const it of interactions) {
    const weight = ACTION_WEIGHT[it.action];
    if (weight === undefined) continue;
    let vector = byUser.get(it.userId);
    if (!vector) byUser.set(it.userId, (vector = new Map()));
    if (vector.has(it.trackId)) continue;
    if (vector.size >= opts.perUserCap) continue;
    vector.set(it.trackId, weight);
  }

  // ---- who has enough evidence to be modelled at all -------------------
  const raters = new Map<string, number>();
  for (const vector of byUser.values()) {
    for (const trackId of vector.keys()) {
      raters.set(trackId, (raters.get(trackId) ?? 0) + 1);
    }
  }
  const eligible = new Set<string>();
  for (const [trackId, count] of raters) {
    if (count >= opts.minRaters) eligible.add(trackId);
  }
  if (eligible.size < 2) {
    return { neighbors: new Map(), rated: eligible.size, truncated: false };
  }

  // ---- column norms, for the cosine denominator ------------------------
  const norm = new Map<string, number>();
  for (const vector of byUser.values()) {
    for (const [trackId, weight] of vector) {
      if (!eligible.has(trackId)) continue;
      norm.set(trackId, (norm.get(trackId) ?? 0) + weight * weight);
    }
  }
  for (const [trackId, sum] of norm) norm.set(trackId, Math.sqrt(sum));

  // ---- co-occurrence ---------------------------------------------------
  // `dot` accumulates the numerator; `support` counts the distinct listeners
  // behind each pair, which is both the noise filter and the privacy floor.
  const dot = new Map<string, number>();
  const support = new Map<string, number>();
  let pairs = 0;
  let truncated = false;

  for (const vector of byUser.values()) {
    const items = [...vector].filter(([trackId]) => eligible.has(trackId));
    if (items.length < 2) continue;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (pairs >= opts.maxPairs) {
          truncated = true;
          break;
        }
        pairs++;
        const [a, wa] = items[i];
        const [b, wb] = items[j];
        // one key per unordered pair; the lists are mirrored when emitted
        const key = a < b ? a + PAIR_SEP + b : b + PAIR_SEP + a;
        dot.set(key, (dot.get(key) ?? 0) + wa * wb);
        support.set(key, (support.get(key) ?? 0) + 1);
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  // ---- normalise, threshold, keep the best ----------------------------
  const neighbors = new Map<string, Neighbor[]>();
  const link = (from: string, to: string, score: number) => {
    const list = neighbors.get(from);
    if (list) list.push({ trackId: to, score });
    else neighbors.set(from, [{ trackId: to, score }]);
  };

  for (const [key, sum] of dot) {
    if ((support.get(key) ?? 0) < opts.minSupport) continue;
    const split = key.indexOf(PAIR_SEP);
    const a = key.slice(0, split);
    const b = key.slice(split + 1);
    const denominator = (norm.get(a) ?? 0) * (norm.get(b) ?? 0);
    if (denominator === 0) continue;
    // A pair whose evidence cancels out (one save, one bury) is not a link in
    // either direction — it is two people disagreeing, which says nothing.
    const score = round(sum / denominator);
    if (score === 0) continue;
    link(a, b, score);
    link(b, a, score);
  }

  for (const [trackId, list] of neighbors) {
    list.sort((x, y) => Math.abs(y.score) - Math.abs(x.score));
    neighbors.set(trackId, list.slice(0, opts.topK));
  }

  return { neighbors, rated: eligible.size, truncated };
}

/** Four decimals is far past what a ranking nudge can perceive. */
function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Turn one listener's own reactions into a score for everything else.
 *
 * Their tracks each vote for their neighbours, weighted by how strongly they
 * felt: a saved song pulls its neighbours forward, a buried one pushes its
 * neighbours back. The result is divided by the number of votes cast, so
 * somebody with a huge library doesn't produce systematically bigger numbers
 * than somebody with five saves — the deck blends this against a shuffle, and
 * that blend has to mean the same thing for both of them.
 *
 * Tracks the listener has already reacted to are left out: the deck has its
 * own rules about what may be dealt again, and this is not the place to
 * relitigate them.
 */
export function scoreCandidates(
  neighbors: Map<string, Neighbor[]>,
  mine: Map<string, number>,
): Map<string, number> {
  const scores = new Map<string, number>();
  if (mine.size === 0) return scores;

  let voters = 0;
  for (const [trackId, weight] of mine) {
    const list = neighbors.get(trackId);
    if (!list || list.length === 0) continue;
    voters++;
    for (const n of list) {
      if (mine.has(n.trackId)) continue;
      scores.set(n.trackId, (scores.get(n.trackId) ?? 0) + weight * n.score);
    }
  }
  if (voters === 0) return new Map();

  for (const [trackId, total] of scores) {
    const value = round(total / voters);
    if (value === 0) scores.delete(trackId);
    else scores.set(trackId, value);
  }
  return scores;
}

/**
 * The listener's side of the matrix, from their most recent reactions.
 *
 * Same shape and same cap as the one `buildNeighbors` builds internally, so
 * the vector asking the question matches the vectors that answered it.
 */
/**
 * The reactions worth spending a lookup on.
 *
 * A listener's vector is mostly skips — that is what the deck produces — and
 * each one costs an indexed read to answer with. Worse, fifty small negatives
 * outweigh five saves by sheer count, and the deck would spend its time
 * avoiding things instead of finding them. Rank by conviction and keep the
 * front of the list: saves, steers and buries first, skips only if there is
 * room left. Ties hold their order, which is recency.
 */
export function topSignals(
  vector: Map<string, number>,
  limit: number,
): Map<string, number> {
  if (vector.size <= limit) return vector;
  const ranked = [...vector].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return new Map(ranked.slice(0, limit));
}

export function userVector(
  interactions: Interaction[],
  perUserCap = COLLAB_DEFAULTS.perUserCap,
): Map<string, number> {
  const vector = new Map<string, number>();
  for (const it of interactions) {
    const weight = ACTION_WEIGHT[it.action];
    if (weight === undefined) continue;
    if (vector.has(it.trackId)) continue;
    if (vector.size >= perUserCap) break;
    vector.set(it.trackId, weight);
  }
  return vector;
}
