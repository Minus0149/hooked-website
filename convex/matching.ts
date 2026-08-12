/**
 * Finding a song again on the open catalogues.
 *
 * Split out of `imports.ts` so it holds no Convex imports at all — that is what
 * lets `verify-match.mjs` run these two providers for real and catch the day
 * their response shape changes under us.
 */

export type Row = { title: string; artist: string; album?: string };

export const MIN_CONFIDENCE = 0.4;

export type Match = {
  provider: "itunes" | "deezer";
  providerId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  durationMs: number;
  genre?: string;
  confidence: number;
};

// ------------------------------------------------------------------ matching

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Words that carry no identity. Without dropping these, "The Less I Know The
 * Better" and "The Boat I Row" share two tokens and look 40% alike.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "i", "to", "in", "is", "it",
  "my", "me", "you", "on", "for", "with", "feat", "ft",
]);

function tokens(value: string): Set<string> {
  const all = value.split(" ").filter(Boolean);
  const meaty = all.filter((t) => !STOPWORDS.has(t));
  // a title that is nothing but stopwords still has to compare as something
  return new Set(meaty.length > 0 ? meaty : all);
}

/** Cheap token overlap — enough to catch "wrong song entirely". */
function similar(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const xs = tokens(x);
  const ys = tokens(y);
  let hit = 0;
  for (const token of xs) if (ys.has(token)) hit++;
  return hit / Math.max(xs.size, ys.size);
}

/**
 * How far the matched artist may drift from the one asked for.
 *
 * This is the guard that matters. Search a well-known song and the results come
 * back stacked with covers, club edits and sped-up versions — for some tracks
 * the original isn't in the catalogue at all, so the *only* things on offer are
 * other people's versions. Title similarity alone happily accepts those, and the
 * listener then gets a stranger's recording under the name they recognise.
 * Below this floor we'd rather report the song as not found.
 */
const ARTIST_FLOOR = 0.34;

/**
 * And the same guard on the title. Scoping a search to an artist lists their
 * whole catalogue, so the right artist singing the wrong song scores well on
 * half the formula — this is what stops "The Boat I Row" being imported for
 * "The Less I Know The Better".
 */
const TITLE_FLOOR = 0.5;

function score(row: Row, title: string, artist: string): number {
  const base = 0.62 * similar(row.title, title) + 0.38 * similar(row.artist, artist);
  // Titles tie once "(Remix)" and friends are stripped, so nudge toward the
  // plainest version of the name — usually the original release.
  const verbosity = Math.min(0.08, Math.abs(title.length - row.title.length) / 300);
  return base - verbosity;
}

type ItunesSong = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
};

async function itunesQuery(qs: string): Promise<ItunesSong[] | "throttled"> {
  let res: Response;
  try {
    res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&${qs}`);
  } catch {
    return [];
  }
  if (res.status === 403 || res.status === 429) return "throttled";
  if (!res.ok) return [];
  try {
    return ((await res.json()) as { results?: ItunesSong[] }).results ?? [];
  } catch {
    return [];
  }
}

function pickBest(row: Row, songs: ItunesSong[]): Match | null {
  let best: Match | null = null;
  for (const r of songs) {
    if (!r.previewUrl || !r.artworkUrl100 || !r.trackId) continue;
    if (similar(row.artist, r.artistName ?? "") < ARTIST_FLOOR) continue;
    if (similar(row.title, r.trackName ?? "") < TITLE_FLOOR) continue;
    const confidence = score(row, r.trackName ?? "", r.artistName ?? "");
    if (best && confidence <= best.confidence) continue;
    best = {
      provider: "itunes",
      providerId: String(r.trackId),
      title: r.trackName ?? row.title,
      artist: r.artistName ?? row.artist,
      album: r.collectionName ?? row.album ?? "",
      artwork: r.artworkUrl100.replace(/100x100bb/, "600x600bb"),
      previewUrl: r.previewUrl,
      durationMs: r.trackTimeMillis ?? 0,
      genre: r.primaryGenreName?.toLowerCase(),
      confidence,
    };
  }
  return best;
}

export async function searchItunes(
  row: Row,
  { deep = true }: { deep?: boolean } = {},
): Promise<Match | null | "throttled"> {
  const term = `${row.artist} ${row.title}`.slice(0, 180);
  const first = await itunesQuery(`limit=12&term=${encodeURIComponent(term)}`);
  if (first === "throttled") return "throttled";

  const best = pickBest(row, first);
  if (best) return best;

  // Relevance ranking can bury the original under covers, but a search scoped to
  // the artist lists their own catalogue. Worth one more call before giving up —
  // spaced out, because two back-to-back calls are what trips the throttle.
  if (!deep || first.length === 0) return null;
  await new Promise((r) => setTimeout(r, 3_200));
  const byArtist = await itunesQuery(
    `attribute=artistTerm&limit=100&term=${encodeURIComponent(row.artist.slice(0, 120))}`,
  );
  if (byArtist === "throttled") return "throttled";
  return pickBest(row, byArtist);
}

/**
 * Deezer as a second opinion.
 *
 * It answers `{"data":[],"total":71}` from some regions — a non-zero total with
 * nothing in it is Deezer filtering by the *caller's* IP, not a miss. That reads
 * as "found nothing" unless you look for it, so it's reported separately: the
 * importer can then say the fallback was unavailable instead of quietly
 * pretending the song doesn't exist.
 */
export async function searchDeezer(row: Row): Promise<Match | null | "blocked"> {
  const strict = `artist:"${row.artist.replace(/"/g, "")}" track:"${row.title.replace(/"/g, "")}"`;
  const queries = [strict, `${row.artist} ${row.title}`];
  let blocked = false;

  for (const q of queries) {
    let res: Response;
    try {
      res = await fetch(
        "https://api.deezer.com/search?limit=5&q=" + encodeURIComponent(q),
      );
    } catch {
      continue;
    }
    if (!res.ok) continue;
    let json: {
      total?: number;
      data?: {
        id?: number;
        title?: string;
        duration?: number;
        preview?: string;
        artist?: { name?: string };
        album?: { title?: string; cover_big?: string; cover_medium?: string };
      }[];
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      continue;
    }
    if ((json.total ?? 0) > 0 && (json.data ?? []).length === 0) blocked = true;

    let best: Match | null = null;
    for (const d of json.data ?? []) {
      const cover = d.album?.cover_big || d.album?.cover_medium;
      if (!d.preview || !cover || !d.id) continue;
      if (similar(row.artist, d.artist?.name ?? "") < ARTIST_FLOOR) continue;
      if (similar(row.title, d.title ?? "") < TITLE_FLOOR) continue;
      const confidence = score(row, d.title ?? "", d.artist?.name ?? "");
      if (best && confidence <= best.confidence) continue;
      best = {
        provider: "deezer",
        providerId: String(d.id),
        title: d.title ?? row.title,
        artist: d.artist?.name ?? row.artist,
        album: d.album?.title ?? row.album ?? "",
        artwork: cover,
        previewUrl: d.preview,
        durationMs: (d.duration ?? 0) * 1000,
        confidence,
      };
    }
    if (best && best.confidence >= MIN_CONFIDENCE) return best;
  }
  return blocked ? "blocked" : null;
}

