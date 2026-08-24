/**
 * What we ask before the first card.
 *
 * A cold deck is the worst version of this app: swipe-to-learn needs a dozen
 * swipes before it knows anything, and most people quit before that. Three
 * questions buy enough of a head start to make the first ten cards feel chosen.
 *
 * Language comes first on purpose. Apple's genre taxonomy is almost entirely
 * Western — a whole Bollywood chart comes back tagged "worldwide" — so genre
 * can't carry it, and for the market this is being built for first, being fed
 * songs in a language you don't speak is the fastest way to lose someone.
 * Instead each language maps to the storefronts it charts in, which the
 * catalogue records.
 */

export interface LanguageOption {
  id: string;
  label: string;
  /** iTunes storefronts where this language dominates the charts */
  markets: string[];
  /** genre names that are a strong signal on their own */
  genres?: string[];
}

export const LANGUAGES: LanguageOption[] = [
  { id: "en", label: "English", markets: ["us", "gb", "ca", "au"] },
  { id: "hi", label: "Hindi", markets: ["in"], genres: ["bollywood", "indian pop"] },
  { id: "pa", label: "Punjabi", markets: ["in"], genres: ["punjabi"] },
  { id: "ta", label: "Tamil", markets: ["in"], genres: ["tamil", "kollywood"] },
  { id: "te", label: "Telugu", markets: ["in"], genres: ["telugu"] },
  { id: "ar", label: "Arabic", markets: ["ae", "sa"], genres: ["egyptian pop", "arabic"] },
  { id: "ko", label: "Korean", markets: ["kr"], genres: ["k-pop"] },
  { id: "es", label: "Spanish", markets: ["br"], genres: ["latin", "reggaeton", "latin pop"] },
  { id: "pt", label: "Portuguese", markets: ["br"], genres: ["sertanejo", "funk carioca"] },
  { id: "zh", label: "Mandarin", markets: [], genres: ["mandopop"] },
];

export interface GenreOption {
  id: string;
  label: string;
  /** matched against a track's genre, lowercased, as a substring */
  match: string[];
}

/**
 * Deliberately coarse. These are buckets a person recognises, each mapping to
 * several of Apple's actual genre strings — "hip-hop/rap", "hip-hop" and "rap"
 * are one thing to a listener and three to the catalogue.
 */
export const GENRES: GenreOption[] = [
  { id: "pop", label: "Pop", match: ["pop", "adult contemporary"] },
  { id: "hiphop", label: "Hip-hop & rap", match: ["hip-hop", "rap"] },
  { id: "rnb", label: "R&B & soul", match: ["r&b", "soul", "funk"] },
  { id: "dance", label: "Dance & electronic", match: ["dance", "electronic", "house", "techno", "electronica", "downtempo", "disco"] },
  { id: "rock", label: "Rock", match: ["rock", "metal", "punk", "grunge"] },
  { id: "indie", label: "Indie & alternative", match: ["indie", "alternative"] },
  { id: "country", label: "Country & folk", match: ["country", "folk", "americana"] },
  { id: "latin", label: "Latin", match: ["latin", "reggaeton", "sertanejo"] },
  { id: "desi", label: "Desi", match: ["bollywood", "indian", "punjabi", "tamil", "telugu", "kollywood"] },
  { id: "world", label: "Everything else", match: ["worldwide", "world", "afro", "celtic", "reggae"] },
];

/** How far from the charts someone wants to be taken. */
export const ADVENTURE = [
  { id: "hits", label: "The hits", copy: "Songs plenty of people already know" },
  { id: "mixed", label: "A bit of both", copy: "Familiar names, songs you missed" },
  { id: "deep", label: "Take me deep", copy: "The further off the chart the better" },
] as const;

export type Adventure = (typeof ADVENTURE)[number]["id"];

export interface TastePrefs {
  languages: string[];
  genres: string[];
  adventure: Adventure;
}

export const EMPTY_TASTE: TastePrefs = {
  languages: [],
  genres: [],
  adventure: "mixed",
};

/**
 * How well a track answers what someone asked for, 0 upward.
 *
 * Additive rather than a filter, and that is the important part: a taste
 * profile should tilt the deck, never wall it in. Someone who picks Hindi and
 * hip-hop still meets everything else, just later — otherwise the first
 * interesting thing outside their own description never gets a chance, which is
 * the entire point of swiping.
 */
/**
 * Genre strings arrive punctuated every which way — the bundled catalogue says
 * "hip hop", Apple's charts say "hip-hop/rap", and a substring test between
 * those two finds nothing. Comparing letters only makes them the same thing.
 */
const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function tasteScore(
  track: { genre: string; markets?: string[]; heat?: number },
  prefs: TastePrefs,
): number {
  let score = 0;
  const genre = flatten(track.genre ?? "");

  for (const id of prefs.genres) {
    const g = GENRES.find((x) => x.id === id);
    if (g && g.match.some((m) => genre.includes(flatten(m)))) {
      score += 2;
      break;
    }
  }

  const markets = track.markets ?? [];
  for (const id of prefs.languages) {
    const l = LANGUAGES.find((x) => x.id === id);
    if (!l) continue;
    if (l.genres?.some((m) => genre.includes(flatten(m)))) {
      score += 3; // an explicit genre match is stronger than a chart it appeared in
      break;
    }
    if (l.markets.some((m) => markets.includes(m))) {
      score += 1.5;
      break;
    }
  }

  // "The hits / a bit of both / take me deep" finally does something: `heat`
  // is each track's play count normalised against the catalogue's leader
  // (written by an hourly job, see crons.ts), so the answer tilts the deck
  // toward what everyone is playing — or away from it. Unknown heat counts as
  // unknown, which is exactly what "deep" listeners are asking for.
  if (prefs.adventure === "hits" || prefs.adventure === "deep") {
    const heat = typeof track.heat === "number" ? Math.min(Math.max(track.heat, 0), 1) : 0;
    score += prefs.adventure === "hits" ? heat * 2.5 : (1 - heat) * 1.75;
  }

  return score;
}

/**
 * How strongly a right-swipe's promise still applies to this track.
 *
 * "More like this" re-ranks the visible queue immediately, and the genres it
 * named are kept so refills honour the steer too — without this the gesture's
 * effect died the moment the re-ranked cards were gone.
 */
export function genreBoostScore(
  track: { genre: string },
  boostGenres: string[],
): number {
  if (boostGenres.length === 0) return 0;
  const genre = flatten(track.genre ?? "");
  return boostGenres.some((b) => genre.includes(flatten(b))) ? 1 : 0;
}

/**
 * Only ask about music the deck can actually play.
 *
 * The charts move daily — one pull had 18 Mandopop tracks and no Bollywood,
 * the next had 17 Bollywood and no Mandopop. A hardcoded menu drifts out of
 * step with the catalogue within a day, and picking an option that matches
 * nothing is a promise the deck can't keep.
 *
 * The fallback matters as much: on a cold start the deck is the bundled
 * catalogue, which carries no market tags at all, so filtering strictly would
 * leave almost nothing to choose from. Below a usable number of options, offer
 * the full list rather than a menu of two.
 */
const ENOUGH_TRACKS = 3;
const ENOUGH_OPTIONS = 4;

export function availableTasteOptions(
  catalog: { genre: string; markets?: string[] }[],
): { languages: LanguageOption[]; genres: GenreOption[] } {
  const matches = (prefs: TastePrefs) =>
    catalog.reduce((n, t) => n + (tasteScore(t, prefs) > 0 ? 1 : 0), 0);

  // A language whose only signal is the chart it appeared in cannot be judged
  // against a catalogue that carries no market tags — the bundled one doesn't.
  // Dropping it there would quietly remove English from a cold start, which is
  // absence of evidence being read as evidence of absence.
  const anyMarkets = catalog.some((t) => (t.markets?.length ?? 0) > 0);
  const languages = LANGUAGES.filter((l) => {
    if (!anyMarkets && !l.genres?.length) return true;
    return matches({ ...EMPTY_TASTE, languages: [l.id] }) >= ENOUGH_TRACKS;
  });
  const genres = GENRES.filter(
    (g) => matches({ ...EMPTY_TASTE, genres: [g.id] }) >= ENOUGH_TRACKS,
  );

  return {
    languages: languages.length >= ENOUGH_OPTIONS ? languages : LANGUAGES,
    genres: genres.length >= ENOUGH_OPTIONS ? genres : GENRES,
  };
}

/**
 * Narrow whatever the server stored back into a TastePrefs.
 *
 * The Convex validator keeps `adventure` a plain string on purpose — the
 * database shouldn't be coupled to a union the client happens to use this
 * week — so an old or hand-edited row can hold anything. Casting would let
 * that through; this checks.
 */
export function coerceTaste(raw: unknown): TastePrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const adventure = ADVENTURE.find((a) => a.id === r.adventure)?.id ?? "mixed";
  return {
    languages: strings(r.languages),
    genres: strings(r.genres),
    adventure,
  };
}
