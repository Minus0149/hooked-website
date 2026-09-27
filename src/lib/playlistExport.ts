/**
 * Taking a playlist somewhere else.
 *
 * No Spotify sign-in: a new Spotify app is capped at a handful of named users
 * and can't be opened up without a registered business with a large audience.
 * Instead the playlist becomes a plain list that TuneMyMusic or Soundiiz can
 * read ("paste text" / "upload file") and push into Spotify, Apple Music,
 * YouTube Music and others — free for playlists this size, and it works for
 * everyone today.
 *
 * Mirrored in mobile/src/lib/playlistExport.ts (scripts/check-mirrors.mjs).
 */

export type ExportTrack = { title: string; artist: string; album?: string };

/** TuneMyMusic's transfer page: choose "Free text" as the source, paste, pick a destination. */
export const TUNEMYMUSIC_URL = "https://www.tunemymusic.com/transfer";
/** Soundiiz does the same from "Import playlist → From text / file". */
export const SOUNDIIZ_URL = "https://soundiiz.com/webapp";

/** One "Title - Artist" line per song — the format both services parse best. */
export function playlistText(tracks: ExportTrack[]): string {
  return tracks
    .map((t) => `${clean(t.title)} - ${clean(t.artist)}`)
    .join("\n");
}

/** A CSV with a header row, quoted per RFC 4180 so commas and quotes survive. */
export function playlistCsv(tracks: ExportTrack[]): string {
  const rows = tracks.map((t) => [t.title, t.artist, t.album ?? ""].map(csvCell).join(","));
  return ["Title,Artist,Album", ...rows].join("\r\n") + "\r\n";
}

/** A file name that works on every OS: "hookedcue-liked-songs.csv". */
export function exportFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `hookedcue-${slug || "playlist"}.csv`;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function csvCell(s: string): string {
  const v = clean(s);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
