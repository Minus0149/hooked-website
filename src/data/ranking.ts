import type { Track } from "../types";
import { EMPTY_TASTE, genreBoostScore, tasteScore, type TastePrefs } from "./taste";
import { moodFitFor, type CrowdMoods, type MoodId } from "./mood";
import { likeBias, type TasteModel } from "./predict";

/**
 * How the deck decides what comes next.
 *
 * Pulled out of the reducer because none of it is a state transition — it is
 * arithmetic over a pool of tracks, and arithmetic is the part worth testing.
 * Inside the reducer it could only be exercised by driving a whole store
 * through a swipe, which is why the weights below went years without one.
 *
 * Mirrored in mobile/src/data/ranking.ts, same as taste.ts: two clients that
 * rank differently are two different products.
 */

/**
 * Everything that gets a say in what comes next.
 *
 * These used to be loose arguments, and the two places that ranked a pool
 * disagreed about them: the refill applied the taste answers only when a
 * language or genre had been picked, so someone who asked for "the hits" and
 * nothing else got that honoured on the first deck and quietly dropped on
 * every refill after. Bundling them is what makes one ranking function
 * possible, and one ranking function is what makes that class of drift
 * impossible.
 */
export type Steer = {
  taste: TastePrefs;
  boostGenres: string[];
  affinity: Record<string, number>;
  affinityStrength: number;
  /** The face they picked, or null. An instruction about now, not about them. */
  mood: MoodId | null;
  /** How far a mood match may pull a track forward, in places. */
  moodStrength: number;
  /** What other listeners said tracks feel like. Sparse; usually empty. */
  crowdMoods: CrowdMoods;
  /** What this device learned from their own swipes, or null before evidence. */
  model: TasteModel | null;
  /** How far that model may pull a track, in places. */
  modelStrength: number;
};

/**
 * Client defaults for the two signals that work with no backend at all.
 *
 * Unlike affinity — which is the server's opinion and worth exactly nothing
 * without it — a mood and a locally-trained model are fully available offline,
 * to a signed-out guest, on the baked catalogue. So they default to on here and
 * the runtime config overrides them, rather than defaulting to off and waiting
 * for a server that may never answer.
 */
export const MOOD_PLACES = 16;
export const MODEL_PLACES = 12;

/** A steer that changes nothing, for tests and for the first render. */
export const NO_STEER: Steer = {
  taste: EMPTY_TASTE,
  boostGenres: [],
  affinity: {},
  affinityStrength: 0,
  mood: null,
  moodStrength: MOOD_PLACES,
  crowdMoods: {},
  model: null,
  modelStrength: MODEL_PLACES,
};

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle, then let every signal pull matches forward.
 *
 * Not a sort by score: that would front-load every Hindi hip-hop track in the
 * catalogue and the deck would feel like a playlist someone else made. Shuffling
 * first and biasing second keeps it unpredictable while still opening with
 * things they said they wanted.
 *
 * The weights are an order of confidence, and they are meant to be read that
 * way:
 *
 *   16  the mood they just picked. Highest, because it is the only term about
 *       *now* — someone tapping the sleepy face at 1am is not describing their
 *       taste, they are giving an instruction.
 *   12  what they told us at onboarding. Stated, durable, and theirs.
 *   12  what this device learned from their own swipes, scaled by how much
 *       evidence there is: near zero in a first session, full weight once they
 *       have kept ten songs and buried ten.
 *    9  what the catalogue's other listeners imply (an admin can zero it).
 *    6  a right-swipe's genre steer: one gesture, a nudge.
 *
 * None of them can outrun the shuffle by more than a couple of dozen places,
 * which is what keeps a deck from turning into a playlist. That is also why a
 * mood is a bias and not a filter: pick "party" and the party songs come
 * first, but the deck is still a deck, and the next thing you have never heard
 * is still in it.
 */
export function rankPool(pool: Track[], steer: Steer): Track[] {
  const useAffinity = steer.affinityStrength > 0;
  const useMood = steer.mood !== null && steer.moodStrength > 0;
  const useModel = steer.model !== null && steer.modelStrength > 0;
  const scored = shuffle(pool).map((t, i) => ({
    t,
    // index keeps the shuffle meaningful; score is worth a few places, not all
    key:
      i -
      tasteScore(t, steer.taste) * 12 -
      (useAffinity ? (steer.affinity[t.id] ?? 0) * steer.affinityStrength : 0) -
      genreBoostScore(t, steer.boostGenres) * 6 -
      (useMood ? moodFitFor(t, steer.mood, steer.crowdMoods) * steer.moodStrength : 0) -
      // already damped by the model's own confidence, so an untrained one
      // contributes exactly zero rather than noise
      (useModel ? likeBias(steer.model, t, steer.crowdMoods) * steer.modelStrength : 0),
  }));
  scored.sort((a, b) => a.key - b.key);
  return scored.map((s) => s.t);
}

export function buildQueue(
  catalog: Track[],
  exclude: Set<string>,
  neverArtists: string[],
  steer: Steer,
): Track[] {
  const fresh = catalog.filter(
    (t) => !exclude.has(t.id) && !neverArtists.includes(t.artist),
  );
  // If the user has heard everything, loop the catalog rather than dead-ending
  const pool = fresh.length > 4 ? fresh : catalog.filter((t) => !neverArtists.includes(t.artist));
  return rankPool(pool, steer);
}

/**
 * Queue invariant: every track id appears at most once. Duplicate ids break
 * React's keyed card stack ("two children with the same key") which renders
 * as duplicated/stale card images — this guard makes that impossible.
 */
export function uniqueById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/**
 * Many catalog tracks share one album's artwork. Two of those back-to-back
 * look like "the card didn't change" even when everything works — push
 * same-artwork neighbors apart. Never moves index 0 (the visible card).
 */
export function spreadAlbums(tracks: Track[]): Track[] {
  const out = [...tracks];
  for (let i = 1; i < out.length; i++) {
    if (out[i].artwork === out[i - 1].artwork) {
      const j = out.findIndex((t, k) => k > i && t.artwork !== out[i - 1].artwork);
      if (j > i) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}


/**
 * The deck after a new catalogue arrives: the card on screen stays on screen,
 * and everything behind it is rebuilt.
 *
 * It used to be kept only if the server also carried it. The app opens on its
 * built-in catalogue, the server's arrives two or three seconds later, and a
 * song only the built-in one had was swapped out mid-listen — under the finger
 * of anyone already holding it for the mood ring. It stays for this showing;
 * if the server doesn't carry it, it simply isn't dealt again.
 */
export function keepOnScreen<T extends { id: string }>(head: T | undefined, rebuilt: T[]): T[] {
  if (!head) return rebuilt;
  return [head, ...rebuilt.filter((t) => t.id !== head.id)];
}
