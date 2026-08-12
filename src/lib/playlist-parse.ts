/**
 * Turn whatever someone pastes into rows of {artist, title}.
 *
 * This exists because the official routes are closed: Spotify's API caps a new
 * app at 25 named users until it clears 250K MAU, and Apple's needs a paid
 * developer account. A paste box needs no relationship with either — the
 * exports people already make (Exportify, TuneMyMusic, Music.app's own "Export
 * Playlist") all land here, and so does a plain list typed by hand.
 */

export type ParsedRow = {
  title: string;
  artist: string;
  album?: string;
  spotifyId?: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** How the text was read — shown back so a wrong guess is obvious. */
  format: "csv" | "lines" | "spotify" | "empty";
  /** Lines that carried no usable pair. */
  skipped: number;
  /** Rows dropped because the same song was already in the list. */
  duplicates: number;
  columns?: { title: string; artist: string; album?: string };
};

const TITLE_KEYS = ["track name", "song name", "title", "song", "name", "track"];
const ARTIST_KEYS = ["artist name(s)", "artist name", "artist(s)", "artists", "artist"];
const ALBUM_KEYS = ["album name", "album"];

/** Columns that look right by name but hold an identifier, not a word. */
const NOT_A_NAME = /uri|url|\bid\b|isrc|href|link/;

/** RFC4180-ish: quotes, doubled quotes inside them, one row per line. */
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findColumn(header: string[], keys: string[]): number {
  for (const key of keys) {
    const exact = header.findIndex((h) => h === key);
    if (exact >= 0) return exact;
  }
  for (const key of keys) {
    const fuzzy = header.findIndex((h) => h.includes(key) && !NOT_A_NAME.test(h));
    if (fuzzy >= 0) return fuzzy;
  }
  return -1;
}

const SPOTIFY_TRACK = /(?:spotify:track:|open\.spotify\.com\/track\/)([A-Za-z0-9]{22})/g;

/** "1. ", "12) ", "- " and a trailing "(3:45)" are noise on a hand-typed list. */
function stripListNoise(line: string): string {
  return line
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d{1,3}[.)]\s+/, "")
    .replace(/\s*[([]\d{1,2}:\d{2}[)\]]\s*$/, "")
    .trim();
}

/** Several artists are joined every which way; the first one is the one we search. */
function primaryArtist(value: string): string {
  return value
    .split(/\s*(?:,|;|\/|&|\bfeat\.?\b|\bft\.?\b|\bx\b)\s*/i)[0]
    .trim();
}

const DASH = /\s+[-–—]\s+/;

function pushRow(rows: ParsedRow[], seen: Set<string>, row: ParsedRow): boolean {
  const title = row.title.trim();
  const artist = row.artist.trim();
  if (!title || !artist) return false;
  const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  rows.push({ ...row, title, artist });
  return true;
}

export function parsePlaylist(
  text: string,
  opts: { titleFirst?: boolean } = {},
): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], format: "empty", skipped: 0, duplicates: 0 };
  }

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;

  // ---- a delimited export, if the first line reads like a header ----------
  const head = lines[0];
  const delim = (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? "\t" : ",";
  if (head.includes(delim)) {
    const header = splitDelimited(head, delim).map((h) => h.toLowerCase().trim());
    const ti = findColumn(header, TITLE_KEYS);
    const ai = findColumn(header, ARTIST_KEYS);
    if (ti >= 0 && ai >= 0 && ti !== ai) {
      const bi = findColumn(header, ALBUM_KEYS);
      const uriCol = header.findIndex((h) => h.includes("track") && NOT_A_NAME.test(h));
      for (const line of lines.slice(1)) {
        const cells = splitDelimited(line, delim);
        const spotifyId =
          uriCol >= 0
            ? SPOTIFY_TRACK.exec(cells[uriCol] ?? "")?.[1]
            : undefined;
        SPOTIFY_TRACK.lastIndex = 0;
        const ok = pushRow(rows, seen, {
          title: cells[ti] ?? "",
          artist: primaryArtist(cells[ai] ?? ""),
          album: bi >= 0 ? cells[bi] : undefined,
          spotifyId,
        });
        if (!ok) {
          if ((cells[ti] ?? "").trim() && (cells[ai] ?? "").trim()) duplicates++;
          else skipped++;
        }
      }
      return {
        rows,
        format: "csv",
        skipped,
        duplicates,
        columns: {
          title: header[ti],
          artist: header[ai],
          album: bi >= 0 ? header[bi] : undefined,
        },
      };
    }
  }

  // ---- bare Spotify links: no titles, only ids we can't resolve -----------
  const ids = [...text.matchAll(SPOTIFY_TRACK)].map((m) => m[1]);
  const dashLines = lines.filter((l) => DASH.test(stripListNoise(l))).length;
  if (ids.length > 0 && dashLines === 0) {
    return {
      rows: [],
      format: "spotify",
      skipped: ids.length,
      duplicates: 0,
    };
  }

  // ---- "Artist - Title", one per line -------------------------------------
  for (const raw of lines) {
    const line = stripListNoise(raw);
    let left = "";
    let right = "";
    const dash = line.split(DASH);
    if (dash.length >= 2) {
      left = dash[0];
      right = dash.slice(1).join(" - ");
    } else if (/\sby\s/i.test(line)) {
      const by = line.split(/\sby\s/i);
      right = by[0]; // "Title by Artist" is always title-first
      left = by.slice(1).join(" by ");
    } else {
      skipped++;
      continue;
    }
    const artist = opts.titleFirst ? right : left;
    const title = opts.titleFirst ? left : right;
    const ok = pushRow(rows, seen, {
      title,
      artist: primaryArtist(artist),
    });
    if (!ok) duplicates++;
  }

  return { rows, format: "lines", skipped, duplicates };
}
