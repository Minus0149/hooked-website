import type { Track } from "../types";
import {
  EMPTY_TASTE,
  flattenGenre,
  genreBoostScore,
  isIndianLanguage,
  langMatch,
  tasteScore,
  type TastePrefs,
} from "./taste";
import { moodFitFor, type CrowdMoods, type MoodId } from "./mood";
import { likeBias, type TasteModel } from "./predict";
import { SOUND_PLACES, soundScore, type SoundTaste } from "./sound";

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
  /** The direction their ear leans (data/sound.ts), or null before evidence. */
  sound: SoundTaste | null;
  /** How far a sound match may pull a track, in places, at full confidence. */
  soundStrength: number;
  /** The India/global and picked-language split (runtime config); DEFAULT_MIX when absent. */
  mix?: RegionMix;
};

/**
 * What the deck is made of, in percent. 0 switches a rule off.
 *
 *  - indiaPct: the Indian share for someone who picked no language — a guest,
 *    or "just the hits". This is an India-first product, and before the split
 *    existed the deck was 3% Indian because the catalogue was.
 *  - pickedPct: for someone who did pick, the share in a language they
 *    picked. The rest is discovery — an English-only listener meets some
 *    Hindi, and is never buried in it.
 *
 * Admin-editable (indiaSharePct, pickedLangPct in runtime config).
 */
export type RegionMix = { indiaPct: number; pickedPct: number };
export const DEFAULT_MIX: RegionMix = { indiaPct: 60, pickedPct: 80 };
export const NO_MIX: RegionMix = { indiaPct: 0, pickedPct: 0 };

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
  sound: null,
  soundStrength: SOUND_PLACES,
  mix: NO_MIX,
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
 *   10  how close it sounds to what they keep (data/sound.ts), scaled by
 *       the evidence behind their taste vector. It hears the difference
 *       between two "pop" songs, which none of the label-based terms can.
 *    9  what the catalogue's other listeners imply (an admin can zero it).
 *    6  a right-swipe's genre steer: one gesture, a nudge.
 *
 * None of them can outrun the shuffle by more than a couple of dozen places,
 * which is what keeps a deck from turning into a playlist.
 *
 * A picked mood is the exception, and it is not a weight: it switches the deck.
 * Every track that fits the mood (MOOD_MATCH) comes before every track that
 * doesn't, each group still in the order above — so "party" means the party
 * songs, all of them, in your taste order, and only once they run out does the
 * rest of the deck follow. As a 16-place nudge in a catalogue of two thousand,
 * picking a face changed the next few cards and nothing after them.
 */
export function rankPool(pool: Track[], steer: Steer): Track[] {
  const useAffinity = steer.affinityStrength > 0;
  const useMood = steer.mood !== null && steer.moodStrength > 0;
  const useModel = steer.model !== null && steer.modelStrength > 0;
  const useSound = steer.sound !== null && steer.soundStrength > 0;
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
      (useModel ? likeBias(steer.model, t, steer.crowdMoods) * steer.modelStrength : 0) -
      (useSound
        ? soundScore(steer.sound, t) * steer.soundStrength * (steer.sound?.confidence ?? 0)
        : 0),
  }));
  scored.sort((a, b) => a.key - b.key);
  const ordered = mixDeck(
    scored.map((s) => s.t),
    steer,
  );
  if (!useMood) return spreadArtists(ordered);
  const fits: Track[] = [];
  const rest: Track[] = [];
  for (const t of ordered) {
    (moodFitFor(t, steer.mood, steer.crowdMoods) >= MOOD_MATCH ? fits : rest).push(t);
  }
  // spread each side on its own, so variety never pulls an off-mood song forward
  return [...spreadArtists(fits), ...spreadArtists(rest)];
}

/**
 * Two ranked streams, dealt so that `pct` percent of every stretch of the deck
 * comes from the first — each stream keeping its own order. When one runs out
 * the other simply continues, so nothing is ever dropped.
 */
export function interleave<T>(ordered: T[], inFirst: (t: T) => boolean, pct: number): T[] {
  if (pct <= 0) return ordered;
  const a: T[] = [];
  const b: T[] = [];
  for (const t of ordered) (inFirst(t) ? a : b).push(t);
  const share = Math.min(pct, 100) / 100;
  const out: T[] = [];
  let ia = 0;
  let ib = 0;
  while (ia < a.length || ib < b.length) {
    const wantA = ia < share * (out.length + 1);
    if ((wantA && ia < a.length) || ib >= b.length) out.push(a[ia++]);
    else out.push(b[ib++]);
  }
  return out;
}

/**
 * US country is dealt only to someone who asked for it — at onboarding, or by
 * a right-swipe on a country song. It isn't removed, it goes to the back: a
 * taste filter, not a deletion.
 */
export function unaskedCountry(
  track: Pick<Track, "genre" | "lang">,
  steer: Pick<Steer, "taste" | "boostGenres">,
): boolean {
  if (!flattenGenre(track.genre ?? "").includes("country") || isIndianLanguage(track.lang)) return false;
  if (steer.taste.genres.includes("country")) return false;
  return !steer.boostGenres.some((g) => flattenGenre(g).includes("country"));
}

/**
 * The deck's shape after scoring: country to the back unless asked for, then
 * the region/language split (RegionMix). Only once the catalogue carries
 * language tags — the bundled one doesn't, and a split on guesses would be
 * worse than none.
 */
export function mixDeck(ordered: Track[], steer: Steer): Track[] {
  const back: Track[] = [];
  const front: Track[] = [];
  for (const t of ordered) (unaskedCountry(t, steer) ? back : front).push(t);
  const mix = steer.mix ?? DEFAULT_MIX;
  const languages = steer.taste.languages;
  let mixed = front;
  if (languages.length > 0) {
    mixed = interleave(front, (t) => langMatch(t, languages) > 0, mix.pickedPct);
  } else if (front.some((t) => t.lang)) {
    mixed = interleave(front, (t) => isIndianLanguage(t.lang), mix.indiaPct);
  }
  return back.length ? [...mixed, ...back] : mixed;
}

/**
 * How well a track must fit a mood to count as that mood when one is picked.
 * The same line moodsOf uses to describe a song. On the live catalogue
 * (2026-09-26, 2,149 tracks) it leaves every mood at least a hundred songs:
 * tender 100, sleepy 116, party 489, hyped 510, chill 811, sunny 836.
 */
export const MOOD_MATCH = 0.5;

/** Does this track belong to the picked mood? The visible card is kept when it does. */
export function fitsMood(track: Track, steer: Pick<Steer, "mood" | "crowdMoods">): boolean {
  return steer.mood !== null && moodFitFor(track, steer.mood, steer.crowdMoods) >= MOOD_MATCH;
}

/** No artist twice within this many cards. */
export const ARTIST_GAP = 3;

/**
 * Variety: the same artist never appears twice within ARTIST_GAP cards. Every
 * signal above pulls toward what someone likes, and what someone likes tends
 * to be one artist — so without this a good steer turns into three Diljit
 * songs in a row, which reads as a playlist, not a deck. Moves the repeat to
 * the next card that isn't a repeat; order is otherwise untouched.
 */
export function spreadArtists<T extends { artist: string }>(tracks: T[]): T[] {
  const out = [...tracks];
  for (let i = 1; i < out.length; i++) {
    const recent = new Set(out.slice(Math.max(0, i - ARTIST_GAP + 1), i).map((t) => t.artist));
    if (!recent.has(out[i].artist)) continue;
    const j = out.findIndex((t, k) => k > i && !recent.has(t.artist));
    if (j > i) {
      const [moved] = out.splice(j, 1);
      out.splice(i, 0, moved);
    }
  }
  return out;
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

/**
 * The deck after a mood is picked or cleared.
 *
 * Picking switches the deck: everything re-ranks with the mood's songs first,
 * and the card on screen stays only if it fits the mood too — hold a ballad,
 * pick "party", and the next thing playing is a party song. The replaced card
 * goes back into the deck, not away. Clearing the mood (or a mood the admin has
 * turned off) keeps the card and re-ranks behind it, like a right-swipe.
 */
export function moodQueue(queue: Track[], steer: Steer): Track[] {
  const [head, ...rest] = queue;
  if (!head) return queue;
  const switching = steer.mood !== null && steer.moodStrength > 0;
  if (switching && !fitsMood(head, steer)) {
    return spreadAlbums(uniqueById(rankPool([...rest, head], steer)));
  }
  return spreadAlbums(uniqueById([head, ...rankPool(rest, steer)]));
}
