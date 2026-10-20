/**
 * Song search over the catalogue the app already holds.
 *
 * The whole catalogue is on the device (src/lib/useCatalog.ts), so searching
 * it costs no request, works offline and answers on every keystroke. Mirrored
 * in mobile/src/lib/songSearch.ts by check-mirrors: both apps rank alike.
 *
 * Every word typed has to start a word somewhere in the title, artist or
 * album ("ari sin" finds Arijit Singh). The best match wins: the exact title,
 * then a title or artist that starts with what was typed, then the rest; ties
 * go to the song more people play. When nothing matches, one typo per long
 * word is forgiven ("arjit" still finds Arijit).
 */

export type Searchable = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  heat?: number;
};

/**
 * Punctuation and spacing, spelled out as ranges: Unicode property classes
 * (\p{L}) aren't something every phone's JS engine can be trusted with.
 * ASCII punctuation, Latin-1 punctuation, general punctuation, CJK punctuation.
 */
const PUNCTUATION = /[\s!-\/:-@\[-`{-~\u00a0-\u00bf\u00d7\u00f7\u2000-\u206f\u3000-\u303f\uff01-\uff0f]+/g;

/** Lowercase, Latin accents off, punctuation to spaces. Other scripts kept as they are. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(PUNCTUATION, " ")
    .trim();
}

const words = (s: string) => (s ? s.split(" ") : []);

/** At most one edit (insert, delete, substitute) apart. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * How well one typed word matches a list of words: 3 when it starts one, 2
 * when it is one typo away from a whole word ("arjit" → "arijit"), 1 when it
 * is one typo away from the start of a longer word, 0 when it doesn't match.
 */
function hit(token: string, fieldWords: string[], fuzzy: boolean): number {
  let best = 0;
  for (const w of fieldWords) {
    if (w.startsWith(token)) return 3;
    if (fuzzy && token.length >= 4) {
      if (withinOneEdit(token, w)) best = Math.max(best, 2);
      else
        for (const len of [token.length - 1, token.length, token.length + 1]) {
          if (len > 0 && len < w.length && withinOneEdit(token, w.slice(0, len))) best = Math.max(best, 1);
        }
    }
  }
  return best;
}

/** Do the typed words start consecutive words of `field`, from its first word? */
function leads(tokens: string[], fieldWords: string[]): boolean {
  return tokens.length <= fieldWords.length && tokens.every((tok, i) => fieldWords[i].startsWith(tok));
}

/** An artist credit's separate names: "Pritam, Arijit Singh & Shreya Ghoshal" is three. */
function names(artist: string): string[][] {
  return artist
    .split(/,|&| x | and | feat\.? | ft\.? | with /)
    .map((n) => words(normalizeText(n)))
    .filter((n) => n.length > 0);
}

type Prepared = {
  t: Searchable;
  title: string;
  tw: string[];
  aw: string[];
  lw: string[];
  artistNames: string[][];
};

function score(p: Prepared, q: string, tokens: string[], fuzzy: boolean): number {
  const all = [...p.tw, ...p.aw, ...p.lw];
  const quality = tokens.map((tok) => hit(tok, all, fuzzy));
  if (quality.some((x) => x === 0)) return 0;
  const inTitle = tokens.every((tok) => hit(tok, p.tw, fuzzy) > 0);
  const inArtist = tokens.every((tok) => hit(tok, p.aw, fuzzy) > 0);
  let s = 15;
  if (p.title === q) s = 100;
  else if (leads(tokens, p.tw)) s = 85;
  else if (p.artistNames.some((n) => leads(tokens, n))) s = 75;
  else if (inArtist) s = 60;
  else if (inTitle) s = 50;
  else if (tokens.every((tok) => hit(tok, [...p.tw, ...p.aw], fuzzy) > 0)) s = 35;
  // how cleanly each word matched: exact starts beat typos, whole-word typos beat partial ones
  return s * (quality.reduce((a, b) => a + b, 0) / (3 * tokens.length));
}

/**
 * The catalogue, normalized once and reused for every keystroke: normalizing
 * 5,000+ songs per letter typed made a phone's search lag behind the typing.
 * Keyed on the array itself, so a new catalogue is prepared afresh.
 */
const prepared = new WeakMap<object, Prepared[]>();

function prepare<T extends Searchable>(tracks: T[]): (Prepared & { t: T })[] {
  const hit = prepared.get(tracks);
  if (hit) return hit as (Prepared & { t: T })[];
  const rows = tracks.map((t) => {
    const title = normalizeText(t.title);
    return {
      t,
      title,
      tw: words(title),
      aw: words(normalizeText(t.artist)),
      lw: words(normalizeText(t.album ?? "")),
      artistNames: names(t.artist.toLowerCase()),
    };
  });
  prepared.set(tracks, rows);
  return rows;
}

/**
 * The songs that match `query`, best first, at most `limit`. Duplicates of
 * the same song (same title and artist) are shown once.
 */
export function searchSongs<T extends Searchable>(tracks: T[], query: string, limit = 50): T[] {
  const q = normalizeText(query);
  if (!q) return [];
  const tokens = words(q);
  const prepared = prepare(tracks);

  const run = (fuzzy: boolean) =>
    prepared
      .map((p) => ({ p, s: score(p, q, tokens, fuzzy) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (b.p.t.heat ?? 0) - (a.p.t.heat ?? 0) || a.p.title.length - b.p.title.length);

  let ranked = run(false);
  if (ranked.length === 0) ranked = run(true);

  const seen = new Set<string>();
  const out: T[] = [];
  for (const { p } of ranked) {
    const key = `${p.title}\u0000${p.aw.join(" ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.t);
    if (out.length >= limit) break;
  }
  return out;
}
