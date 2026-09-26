/**
 * The catalogue on the wire: one compact, versioned document.
 *
 * Every client used to subscribe to tracks.list, a 2.2 MB reactive result that
 * arrived as the first websocket message — and when that message stalled, the
 * admin button, a report's "sending…" and every other reply queued behind it.
 * Now the catalogue is a file: the server builds it once per version
 * (convex/catalog.ts), clients fetch it over plain HTTP by version and keep it,
 * and the websocket only carries the tiny version number.
 *
 * This module is the format, shared by the server (which encodes) and both
 * clients (which decode). Mirrored in mobile/src/lib/catalogCodec.ts. The
 * server (web/convex/catalog.ts) imports the web copy.
 *
 * Compaction, all reversible:
 *  - each track is a tuple in COLUMNS order, not an object with repeated keys;
 *    trailing empty fields are dropped;
 *  - Apple's fixed URL prefixes are replaced by a marker ("~"), and the
 *    artwork's standard "/600x600bb.jpg" size suffix is dropped and restored
 *    (lib/art.ts resizes from it, so it must come back exactly);
 *  - hooks are [id, startMs, durationMs, label?] tuples;
 *  - markets are one comma-joined string.
 */

export const CATALOG_FORMAT = 1;

/** A catalogue track as the clients have always received it from tracks.list. */
export type CatalogTrack = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  durationMs: number;
  genre: string;
  accent: string;
  markets?: string[];
  heat?: number;
  energy?: number;
  sound?: string;
  audioMood?: number[];
  vocal?: number;
  audioUrl?: string | null;
  hooks: { id: string; startMs: number; durationMs: number; label?: string }[];
};

export type CatalogDoc = {
  /** format version, so an old client can refuse a document it can't read */
  f: number;
  /** catalogue version this document was built from */
  v: number;
  /** which part this is, and how many make up the whole catalogue */
  part: number;
  parts: number;
  rows: unknown[][];
};

/**
 * Tracks per part. Large downloads from the backend host intermittently crawl
 * (measured 2026-09-26: the same 615 KB file took 1.9 s twice and 50–56 s
 * twice). Several small parts fetched in parallel, each with a timeout and a
 * retry, finish in seconds even when one connection stalls.
 */
export const ROWS_PER_PART = 400;

const ART_PREFIX = /^https:\/\/is([1-5])-ssl\.mzstatic\.com\/image\/thumb\//;
const ART_SIZE = "/600x600bb.jpg";
const PREVIEW_PREFIX = "https://audio-ssl.itunes.apple.com/itunes-assets/";

/** "https://is1-ssl.mzstatic.com/image/thumb/X/600x600bb.jpg" -> "~1X" */
export function packArtwork(url: string): string {
  const m = url.match(ART_PREFIX);
  if (!m || !url.endsWith(ART_SIZE)) return url;
  return `~${m[1]}${url.slice(m[0].length, -ART_SIZE.length)}`;
}

export function unpackArtwork(s: string): string {
  if (!s.startsWith("~")) return s;
  return `https://is${s[1]}-ssl.mzstatic.com/image/thumb/${s.slice(2)}${ART_SIZE}`;
}

export function packPreview(url: string): string {
  return url.startsWith(PREVIEW_PREFIX) ? `~${url.slice(PREVIEW_PREFIX.length)}` : url;
}

export function unpackPreview(s: string): string {
  return s.startsWith("~") ? PREVIEW_PREFIX + s.slice(1) : s;
}

const round = (n: number, places: number) => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};

/** Tuple order. Appending is safe; reordering is a new CATALOG_FORMAT. */
export function encodeTrack(t: CatalogTrack): unknown[] {
  const row: unknown[] = [
    t.trackId,
    t.title,
    t.artist,
    t.album,
    packArtwork(t.artwork),
    packPreview(t.previewUrl),
    t.durationMs,
    t.genre,
    t.accent,
    t.hooks.map((h) => (h.label ? [h.id, h.startMs, h.durationMs, h.label] : [h.id, h.startMs, h.durationMs])),
    t.markets && t.markets.length ? t.markets.join(",") : null,
    typeof t.heat === "number" ? round(t.heat, 3) : null,
    typeof t.energy === "number" ? round(t.energy, 3) : null,
    t.sound ?? null,
    t.audioMood ? t.audioMood.map((x) => round(x, 3)) : null,
    typeof t.vocal === "number" ? round(t.vocal, 3) : null,
    t.audioUrl ?? null,
  ];
  // trailing empties carry no information
  while (row.length > 10 && row[row.length - 1] === null) row.pop();
  return row;
}

export function decodeTrack(r: unknown[]): CatalogTrack {
  const at = (i: number) => (i < r.length ? r[i] : null);
  const num = (i: number) => (typeof at(i) === "number" ? (at(i) as number) : undefined);
  const hooks = (Array.isArray(r[9]) ? (r[9] as unknown[][]) : []).map((h) => {
    const hook: CatalogTrack["hooks"][number] = {
      id: String(h[0]),
      startMs: Number(h[1]),
      durationMs: Number(h[2]),
    };
    if (typeof h[3] === "string") hook.label = h[3];
    return hook;
  });
  const t: CatalogTrack = {
    trackId: String(r[0]),
    title: String(r[1] ?? ""),
    artist: String(r[2] ?? ""),
    album: String(r[3] ?? ""),
    artwork: unpackArtwork(String(r[4] ?? "")),
    previewUrl: unpackPreview(String(r[5] ?? "")),
    durationMs: Number(r[6] ?? 0),
    genre: String(r[7] ?? ""),
    accent: String(r[8] ?? ""),
    hooks,
  };
  if (typeof at(10) === "string") t.markets = (at(10) as string).split(",");
  if (num(11) !== undefined) t.heat = num(11);
  if (num(12) !== undefined) t.energy = num(12);
  if (typeof at(13) === "string") t.sound = at(13) as string;
  if (Array.isArray(at(14))) t.audioMood = (at(14) as number[]).map(Number);
  if (num(15) !== undefined) t.vocal = num(15);
  // tracks.list always sent audioUrl, null when the track has no uploaded audio
  t.audioUrl = typeof at(16) === "string" ? (at(16) as string) : null;
  return t;
}

/** The catalogue as its parts (at least one, even when empty). */
export function encodeCatalog(tracks: CatalogTrack[], version: number, perPart = ROWS_PER_PART): CatalogDoc[] {
  const parts = Math.max(1, Math.ceil(tracks.length / perPart));
  return Array.from({ length: parts }, (_, part) => ({
    f: CATALOG_FORMAT,
    v: version,
    part,
    parts,
    rows: tracks.slice(part * perPart, (part + 1) * perPart).map(encodeTrack),
  }));
}

/** One part, or null when it's from a format this client doesn't know. */
export function decodePart(
  doc: unknown,
): { version: number; part: number; parts: number; tracks: CatalogTrack[] } | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Partial<CatalogDoc>;
  if (d.f !== CATALOG_FORMAT || typeof d.v !== "number" || !Array.isArray(d.rows)) return null;
  if (typeof d.part !== "number" || typeof d.parts !== "number") return null;
  return { version: d.v, part: d.part, parts: d.parts, tracks: d.rows.map((r) => decodeTrack(r as unknown[])) };
}

/**
 * The whole catalogue from its parts, in order — or null unless every part is
 * present and all come from the same version (a build landing mid-download
 * must not splice two catalogues together).
 */
export function joinParts(docs: unknown[]): { version: number; tracks: CatalogTrack[] } | null {
  const parts = docs.map(decodePart);
  if (parts.length === 0 || parts.some((p) => p === null)) return null;
  const ok = parts as NonNullable<ReturnType<typeof decodePart>>[];
  const { version, parts: total } = ok[0];
  if (ok.length !== total || ok.some((p) => p.version !== version || p.parts !== total)) return null;
  ok.sort((a, b) => a.part - b.part);
  if (ok.some((p, i) => p.part !== i)) return null;
  return { version, tracks: ok.flatMap((p) => p.tracks) };
}

/**
 * What a client should do, given the version it has cached and the version the
 * server says is current. `undefined` server version = not known yet (the tiny
 * version query hasn't answered), and 0 = no file built yet: use the cache if
 * there is one, and wait.
 */
export function catalogAction(
  cached: number | null,
  server: number | null | undefined,
): "wait" | "use-cache" | "fetch" {
  // 0 = the server has no file yet (first build pending): same as not knowing
  if (server === undefined || server === null || server <= 0) return cached === null ? "wait" : "use-cache";
  if (cached !== null && cached === server) return "use-cache";
  return "fetch";
}

/** A part's versioned URL; the version makes it safely cacheable forever. */
export function catalogUrl(siteUrl: string, version: number, part: number): string {
  return `${siteUrl.replace(/\/+$/, "")}/catalog?v=${encodeURIComponent(String(version))}&part=${part}`;
}

/** What catalog:version returns: the version clients should hold, and its part count. */
export type CatalogVersion = { v: number; parts: number };

/** Per-attempt timeouts. Short first, so a stalled request is abandoned fast;
 * longer later, so a genuinely slow phone connection still gets there. */
export const PART_TIMEOUTS_MS = [5_000, 8_000, 12_000, 20_000, 30_000];

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

async function fetchPart(
  fetchImpl: FetchLike,
  url: string,
  timeouts: number[],
): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < timeouts.length; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeouts[attempt]);
    try {
      // a retry gets its own URL so no cache or proxy can hand back the stalled one
      const res = await fetchImpl(attempt === 0 ? url : `${url}&retry=${attempt}`, { signal: ctl.signal });
      if (!res.ok) throw new Error(`catalog part ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("catalog part failed");
}

/**
 * Fetch every part of one catalogue version in parallel and join them.
 * Measured in Edge against the live backend: 1.2–1.6 s normally; when a part's
 * request stalled (it happens — the same request once took 354 s), the retry
 * recovered and the whole catalogue arrived in under 10 s.
 */
export async function fetchCatalog(
  siteUrl: string,
  ver: CatalogVersion,
  fetchImpl: FetchLike,
  timeouts: number[] = PART_TIMEOUTS_MS,
): Promise<{ version: number; tracks: CatalogTrack[]; docs: unknown[] }> {
  const docs = await Promise.all(
    Array.from({ length: ver.parts }, (_, i) => fetchPart(fetchImpl, catalogUrl(siteUrl, ver.v, i), timeouts)),
  );
  const joined = joinParts(docs);
  if (!joined) throw new Error("catalog parts didn't match (a new version landed mid-download)");
  return { ...joined, docs };
}
