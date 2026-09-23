import type { Track } from "./types";

export type TrackFilter = "all" | "needs-hooks" | "drafts" | "tagged";

export const TRACK_FILTERS: { id: TrackFilter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "needs-hooks", label: "needs hooks" },
  { id: "drafts", label: "drafts" },
  { id: "tagged", label: "mood-tagged" },
];

const fold = (s: string) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Which tracks the dashboard lists. Search matches title or artist, ignoring
 * case and accents — "beyonce" should find Beyoncé.
 */
export function filterTracks<T extends Pick<Track, "title" | "artist" | "hidden" | "hooks" | "moods">>(
  tracks: T[],
  query: string,
  filter: TrackFilter,
): T[] {
  const q = fold(query.trim());
  return tracks.filter((t) => {
    if (q && !fold(`${t.title} ${t.artist}`).includes(q)) return false;
    if (filter === "needs-hooks") return t.hooks.filter((h) => h.active).length === 0;
    if (filter === "drafts") return t.hidden === true;
    if (filter === "tagged") return (t.moods?.length ?? 0) > 0;
    return true;
  });
}
