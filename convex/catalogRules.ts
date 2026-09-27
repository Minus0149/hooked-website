/**
 * What the catalogue is made of, and what the deck may deal from it.
 *
 * Measured on prod (2026-09-27, 3,076 songs): the old pull was a grid of ten
 * storefronts × ten Apple genres, so India's slice was mostly India's *Western*
 * genre charts — 141 US-style country songs charted "in India" — while the
 * Bollywood and Punjabi songs arrived filed as "worldwide" and nothing could
 * tell they were Indian. Only 32 songs were tagged Bollywood.
 *
 * So the sources are now chosen per market (India's own genre charts first,
 * then the Western headline charts), each track carries a language and a
 * region, and a curation pass hides what a discovery deck shouldn't deal:
 * filler, covers and sped-up variants, one artist flooding the deck, devotional
 * chart spill, and songs that left every chart long ago. Hidden is reversible —
 * an admin unhide sets `keep`, and curation never touches that track again.
 *
 * Everything here is pure so it can be tested without a database.
 */

// ------------------------------------------------------------------ sources

export type Feed = {
  /** where it comes from, for reports */
  id: string;
  url: string;
  /** the storefront, recorded on the track as a market */
  country: string;
  /** a storefront's main chart (recorded as `headlineAt`; counts toward an artist's strongest songs) */
  headline: boolean;
  /** rss.applemarketingtools.com (v2 shape) rather than the legacy iTunes RSS */
  v2?: boolean;
};

const legacy = (country: string, genre: number | null, limit = 100) =>
  `https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/${genre ? `genre=${genre}/` : ""}json`;
const mostPlayed = (country: string) =>
  `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/100/songs.json`;

/**
 * India first. Each India feed was checked on 2026-09-27 to return its own
 * music (Bollywood 98/98 Bollywood, Punjabi 100/100 Punjabi, Tamil, Telugu,
 * Malayalam, Kannada, Marathi, Indian Pop…). Devotional & Spiritual is left
 * out on purpose: it floods every Indian chart during festival weeks and is
 * not what a discovery deck is for. The Western storefronts keep only their
 * headline charts and a few big genres — no genre=6 (country) anywhere except
 * one small US feed, so a listener who opts in still gets new country.
 */
export const FEEDS: Feed[] = [
  { id: "in:most-played", url: mostPlayed("in"), country: "in", headline: true, v2: true },
  { id: "in:all", url: legacy("in", null), country: "in", headline: true },
  { id: "in:bollywood", url: legacy("in", 1263), country: "in", headline: false },
  { id: "in:indian-pop", url: legacy("in", 1185), country: "in", headline: false },
  { id: "in:punjabi", url: legacy("in", 100045), country: "in", headline: false },
  { id: "in:tamil", url: legacy("in", 1264), country: "in", headline: false },
  { id: "in:telugu", url: legacy("in", 1265), country: "in", headline: false },
  { id: "in:regional", url: legacy("in", 1266), country: "in", headline: false },
  { id: "in:malayalam", url: legacy("in", 100035), country: "in", headline: false },
  { id: "in:kannada", url: legacy("in", 100036), country: "in", headline: false },
  { id: "in:marathi", url: legacy("in", 100037, 50), country: "in", headline: false },
  { id: "in:bengali", url: legacy("in", 100046, 50), country: "in", headline: false },
  { id: "in:indian-folk", url: legacy("in", 1279, 50), country: "in", headline: false },
  { id: "in:sufi-ghazal", url: legacy("in", 1268, 50), country: "in", headline: false },
  { id: "in:hip-hop", url: legacy("in", 18), country: "in", headline: false },
  { id: "us:most-played", url: mostPlayed("us"), country: "us", headline: true, v2: true },
  { id: "us:all", url: legacy("us", null), country: "us", headline: true },
  { id: "gb:most-played", url: mostPlayed("gb"), country: "gb", headline: true, v2: true },
  { id: "gb:all", url: legacy("gb", null), country: "gb", headline: true },
  { id: "us:pop", url: legacy("us", 14), country: "us", headline: false },
  { id: "us:hip-hop", url: legacy("us", 18), country: "us", headline: false },
  { id: "us:rnb", url: legacy("us", 15), country: "us", headline: false },
  { id: "us:dance", url: legacy("us", 17), country: "us", headline: false },
  { id: "us:electronic", url: legacy("us", 7), country: "us", headline: false },
  { id: "us:alternative", url: legacy("us", 20), country: "us", headline: false },
  { id: "gb:dance", url: legacy("gb", 17), country: "gb", headline: false },
  { id: "us:country", url: legacy("us", 6, 50), country: "us", headline: false },
  { id: "ae:most-played", url: mostPlayed("ae"), country: "ae", headline: true, v2: true },
  { id: "ae:all", url: legacy("ae", null), country: "ae", headline: true },
  { id: "sa:all", url: legacy("sa", null), country: "sa", headline: true },
  { id: "kr:all", url: legacy("kr", null), country: "kr", headline: true },
  { id: "br:all", url: legacy("br", null), country: "br", headline: true },
];

// ------------------------------------------------------------------ language

/** Languages the deck groups as Indian. "in" is Indian with no finer signal. */
export const INDIAN_LANGS = ["hi", "pa", "ta", "te", "ml", "kn", "mr", "bn", "ur", "in"] as const;
export const isIndianLang = (lang: string | undefined) =>
  !!lang && (INDIAN_LANGS as readonly string[]).includes(lang);

const SCRIPTS: [RegExp, string][] = [
  [/[\u0900-\u097F]/, "hi"],
  [/[\u0A00-\u0A7F]/, "pa"],
  [/[\u0B80-\u0BFF]/, "ta"],
  [/[\u0C00-\u0C7F]/, "te"],
  [/[\u0C80-\u0CFF]/, "kn"],
  [/[\u0D00-\u0D7F]/, "ml"],
  [/[\u0980-\u09FF]/, "bn"],
  [/[\u0600-\u06FF]/, "ar"],
  [/[\uAC00-\uD7AF\u1100-\u11FF]/, "ko"],
  [/[\u3040-\u30FF]/, "ja"],
  [/[\u4E00-\u9FFF]/, "zh"],
  [/[\u0400-\u04FF]/, "ru"],
];

const GENRE_LANG: [RegExp, string][] = [
  [/bollywood|indian pop|hindi|ghazal|sufi|qawwali|filmi/, "hi"],
  [/punjabi|bhangra/, "pa"],
  [/tamil|kollywood/, "ta"],
  [/telugu|tollywood/, "te"],
  [/malayalam/, "ml"],
  [/kannada/, "kn"],
  [/marathi/, "mr"],
  [/bengali|bangla/, "bn"],
  [/regional indian|indian folk|indian classical|carnatic|hindustani|^indian$|devotional/, "in"],
  [/k-pop|korean/, "ko"],
  [/arabic|khaleeji|egyptian|levant|middle east/, "ar"],
  [/latin|reggaeton|urbano|salsa|bachata/, "es"],
  [/sertanejo|mpb|funk carioca|pagode|axé|brazil/, "pt"],
];

type LangInput = { title: string; artist: string; genre: string; markets?: string[] };

// Romanised Hindi and Punjabi words distinctive enough to name the language on
// their own. Titles like "Hum Tere Pyar Mein" arrive filed as "rock" from a
// storefront's genre chart, and nothing else about them says Hindi.
const HINDI_WORDS = /\b(?:pyaa?r|ishq|dil|dilbar|naina|mera|meri|tera|teri|tere|tujhe|mujhe|zindagi|sajna|sajni|jaana|yaara?|kya|nahi|hai|mein|raat|saath|hisaab|dhadkan|mohabbat|chand|chaand|khwab|aankhein|jaanam|humsafar)\b/i;
const PUNJABI_WORDS = /\b(?:kudi|munde?|jatt|gabru|pind|soniye|sohneya|yaaran|jattiye|bapu|velly|putt)\b/i;

/** Where Apple files hip-hop that isn't the US's; "hip-hop/rap" is the US one. */
const WESTERN_GENRE = /^(?:pop|rock|country|r&b|soul|hip-hop\/rap|rap|dance|electronic|electronica|house|trance|techno|alternative|indie|metal|hard rock|punk|singer\/songwriter|jazz|blues|pop\/rock|adult alternative|christian|americana|folk|disco|funk|reggae|grunge|contemporary country|honky tonk|urban cowboy)/;

/**
 * The language a track's own words and genre name, or "" — the signals that
 * can't be wrong about the song in front of them. The storefronts it charts in
 * are left to langOf, since India's charts carry plenty of English.
 */
export function strongLang(t: LangInput): string {
  const text = `${t.title} ${t.artist}`;
  for (const [re, lang] of SCRIPTS) if (re.test(text)) return lang;
  const genre = (t.genre ?? "").toLowerCase();
  for (const [re, lang] of GENRE_LANG) if (re.test(genre)) return lang;
  if (PUNJABI_WORDS.test(t.title)) return "pa";
  if (HINDI_WORDS.test(t.title)) return "hi";
  return "";
}

/**
 * Each lead artist's language, from their songs that name one outright — so
 * AP Dhillon's song filed under Apple's "hip-hop/rap" is Punjabi because his
 * other songs are filed under Punjabi.
 */
export function artistLanguages(tracks: LangInput[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const t of tracks) {
    const lang = strongLang(t);
    if (!lang) continue;
    const k = leadArtist(t.artist);
    const v = votes.get(k) ?? new Map<string, number>();
    v.set(lang, (v.get(lang) ?? 0) + 1);
    votes.set(k, v);
  }
  const out = new Map<string, string>();
  for (const [artist, v] of votes) out.set(artist, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

/**
 * A track's language, from the most specific signal it has: its script, its
 * genre or its words (strongLang), then what the artist's other songs are,
 * then where it charts. "" when nothing points anywhere — better unknown than
 * wrong. `byArtist` is artistLanguages() over the catalogue, when there is one.
 */
export function langOf(t: LangInput, byArtist?: Map<string, string>): string {
  const strong = strongLang(t);
  if (strong) return strong;
  const hinted = byArtist?.get(leadArtist(t.artist));
  if (hinted) return hinted;
  const genre = (t.genre ?? "").toLowerCase();
  const markets = t.markets ?? [];
  const western = markets.some((m) => ["us", "gb", "ca", "au"].includes(m));
  if (!western && markets.includes("in")) {
    // Apple files much of India's own output as "Worldwide", its film songs as
    // "Soundtrack" with a (From "Film") title, and its rap as "Hip-Hop"
    if (/world|^hip-hop$/.test(genre) || /\(from ["“]/i.test(t.title)) return "in";
  }
  if (/world/.test(genre) && (markets.includes("ae") || markets.includes("sa")) && !western) return "ar";
  if (western) return "en";
  if (markets.includes("kr")) return "ko";
  // a Western genre chart in a non-Western storefront is still Western music
  if (WESTERN_GENRE.test(genre)) return "en";
  return "";
}

// ------------------------------------------------------------------ filler

const VARIANT = /\((?:[^)]*\b(?:sped[ -]?up|slowed|reverb|bass boost(?:ed)?|nightcore|8d audio|8d|lo-?fi version|super slowed|ultra slowed)\b[^)]*)\)|\b(?:sped[ -]?up|slowed \+ reverb|bass boosted)\b/i;
const COVER = /\b(?:karaoke|originally performed by|in the style of|made famous by|as made famous|tribute to|backing track|cover version|instrumental version|lullaby (?:version|rendition)|piano version of)\b/i;
const FILLER_GENRE = /sound effects|meditation|healing|nature sounds|sleep|relaxation|fitness|workout|white noise|children|karaoke|devotional/;

/** Why this track shouldn't be dealt at all, or null. */
export function fillerReason(t: { title: string; artist: string; genre: string }): string | null {
  const genre = (t.genre ?? "").toLowerCase();
  if (/devotional/.test(genre)) return "devotional";
  if (FILLER_GENRE.test(genre)) return "filler";
  if (COVER.test(t.title) || COVER.test(t.artist)) return "cover";
  if (VARIANT.test(t.title)) return "variant";
  return null;
}

// ------------------------------------------------------------------ curation

export type CurationTrack = {
  trackId: string;
  title: string;
  artist: string;
  genre: string;
  markets?: string[];
  heat?: number;
  releaseDate?: string;
  chartedAt?: number;
  headlineAt?: number;
  hidden?: boolean;
  hiddenBy?: string;
  keep?: boolean;
  ownerUserId?: string;
  origin?: string;
  createdAt: number;
};

export type CurationOptions = {
  now: number;
  artistCap: number;
  staleWeeks: number;
  maxAgeYears: number;
  /** an old recording stays dealable only if a chart carried it this recently */
  oldChartDays: number;
};

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const YEAR = 365.25 * 86_400_000;

/** The artist credited first ("A, B & C" / "A feat. B" → A). */
export function leadArtist(artist: string): string {
  return (artist.split(/\s*(?:,|&| feat\.?| ft\.?| x | with )\s*/i)[0] ?? artist).trim().toLowerCase();
}

/**
 * Which tracks curation hides, and why. Only curation's own hides are ever
 * reversed here; an admin's hide, an admin's "keep", and anything an artist or
 * a listener's import put in the catalogue are left exactly as they are.
 */
export function curate(tracks: CurationTrack[], o: CurationOptions): Map<string, string | null> {
  const decision = new Map<string, string | null>();
  const managed = tracks.filter(
    (t) => !t.keep && !t.ownerUserId && t.origin !== "import" && t.origin !== "artist" && (!t.hidden || t.hiddenBy === "curation"),
  );

  const survivors: CurationTrack[] = [];
  for (const t of managed) {
    const lastCharted = t.chartedAt ?? t.createdAt;
    const released = t.releaseDate ? Date.parse(t.releaseDate) : NaN;
    let reason = fillerReason(t);
    if (!reason && o.now - lastCharted > o.staleWeeks * WEEK) reason = "stale";
    // An old recording stays only while a chart has been *seen* carrying it
    // lately — within the last sweep or two, not the looser staleWeeks. A
    // classic back on a chart is news; last year's chart residue isn't. Songs
    // from before the chart clock existed have no sighting, so an old one
    // stays only once a sweep finds it on a chart.
    const seenCharting = t.chartedAt ?? 0;
    if (!reason && Number.isFinite(released) && o.now - released > o.maxAgeYears * YEAR && o.now - seenCharting > o.oldChartDays * DAY) {
      reason = "old";
    }
    decision.set(t.trackId, reason);
    if (!reason) survivors.push(t);
  }

  // One artist can't flood the deck: keep their strongest few.
  const byArtist = new Map<string, CurationTrack[]>();
  for (const t of survivors) {
    const k = leadArtist(t.artist);
    byArtist.set(k, [...(byArtist.get(k) ?? []), t]);
  }
  const strength = (t: CurationTrack) =>
    (t.heat ?? 0) * 10 + (t.markets?.length ?? 0) + (t.headlineAt ? 2 : 0) + (t.chartedAt ?? t.createdAt) / 1e13;
  for (const list of byArtist.values()) {
    if (list.length <= o.artistCap) continue;
    list.sort((a, b) => strength(b) - strength(a));
    for (const t of list.slice(o.artistCap)) decision.set(t.trackId, "artist-cap");
  }
  return decision;
}
