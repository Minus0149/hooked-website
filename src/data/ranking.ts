import type { Track } from "../types";
import { genreBoostScore, tasteScore, type TastePrefs } from "./taste";

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
 * way. What someone *told* us carries most (12). What the catalogue's other
 * listeners imply carries less (9 by default, and an admin can take it to
 * zero) — that is inference, and it is only ever as good as how many people
 * have swiped. A right-swipe's genre steer carries least (6): one gesture, a
 * nudge, not a stated preference. None of them can outrun the shuffle by more
 * than a couple of dozen places, which is what keeps a deck from turning into
 * a playlist.
 */
export function rankPool(pool: Track[], steer: Steer): Track[] {
  const useAffinity = steer.affinityStrength > 0;
  const scored = shuffle(pool).map((t, i) => ({
    t,
    // index keeps the shuffle meaningful; score is worth a few places, not all
    key:
      i -
      tasteScore(t, steer.taste) * 12 -
      (useAffinity ? (steer.affinity[t.id] ?? 0) * steer.affinityStrength : 0) -
      genreBoostScore(t, steer.boostGenres) * 6,
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
