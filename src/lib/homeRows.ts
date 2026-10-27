import type { Track } from "../types";

/**
 * Home's "Because you wanted more <genre>" rows.
 *
 * The rows used to skip only Liked songs, so a swipe left on Bon Jovi was
 * followed straight away by "Because you wanted more rock: Livin' On A
 * Prayer, Bon Jovi" on Home — the one thing the swipe promised never to do.
 * They now keep the deck's own promises: no blocked artist, no buried song,
 * nothing already kept anywhere (Liked, Discoveries or a playlist), unless the
 * listener's own Settings say blocked or buried songs may come back.
 */
export interface BecauseRowsInput {
  catalog: readonly Track[];
  boostGenres: readonly string[];
  liked: readonly Track[];
  discoveries: readonly Track[];
  playlists: readonly { tracks: readonly Track[] }[];
  queue: readonly Track[];
  neverArtists: readonly string[];
  neverTracks: readonly string[];
  includeBuried?: boolean;
  includeBlockedArtists?: boolean;
  perRow?: number;
}

/** title·artist without "(feat. …)"-style brackets: catches chart+import twins with different ids */
export const songKey = (t: Pick<Track, "title" | "artist">) =>
  `${t.title}·${t.artist}`.toLowerCase().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();

export function becauseRows(input: BecauseRowsInput): { genre: string; tracks: Track[] }[] {
  const perRow = input.perRow ?? 8;
  const kept = [
    ...input.liked,
    ...input.discoveries,
    ...input.playlists.flatMap((p) => p.tracks),
  ];
  const keptIds = new Set(kept.map((t) => t.id));
  const keptKeys = new Set(kept.map(songKey));
  const queueIds = new Set(input.queue.map((t) => t.id));
  const blocked = new Set(input.includeBlockedArtists ? [] : input.neverArtists);
  const buried = new Set(input.includeBuried ? [] : input.neverTracks);
  // a buried song stays buried under its twin's id too
  const buriedKeys = new Set(
    input.includeBuried
      ? []
      : input.catalog.filter((t) => buried.has(t.id)).map(songKey),
  );
  const genres =
    input.boostGenres.length > 0
      ? input.boostGenres
      : [...new Set(input.liked.map((t) => t.genre))].slice(0, 2);
  return genres
    .map((genre) => {
      const seen = new Set<string>();
      const tracks: Track[] = [];
      for (const t of input.catalog) {
        if (tracks.length >= perRow) break;
        if (t.genre !== genre) continue;
        if (keptIds.has(t.id) || queueIds.has(t.id)) continue;
        if (blocked.has(t.artist) || buried.has(t.id)) continue;
        const key = songKey(t);
        if (keptKeys.has(key) || buriedKeys.has(key) || seen.has(key)) continue;
        seen.add(key);
        tracks.push(t);
      }
      return { genre, tracks };
    })
    .filter((r) => r.tracks.length > 0);
}
