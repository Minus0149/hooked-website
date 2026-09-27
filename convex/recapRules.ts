/**
 * "Your week in hooks" — the arithmetic, pure so it's testable.
 *
 * Built from the listener's own swipes over the last seven days. Every card in
 * hookedcue starts at its hook, so every card heard is an intro skipped — that
 * is the honest version of the headline number, not an estimate of seconds.
 */

export const RECAP_DAYS = 7;
/** Below this many cards there isn't a week to talk about. */
export const RECAP_MIN_CARDS = 5;

export type RecapSwipe = {
  action: "skip" | "save" | "more" | "never";
  trackId: string;
  artist: string;
  genre: string;
};

export type Recap = {
  cards: number;
  saves: number;
  skips: number;
  more: number;
  nevers: number;
  /** 0..1 */
  saveRate: number;
  /** artists saved this week that were never saved before it */
  newArtists: number;
  topArtists: string[];
  topGenres: string[];
  savedTrackIds: string[];
};

const topBy = (values: string[], n: number) => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
};

export function computeRecap(week: RecapSwipe[], artistsSavedBefore: Set<string>): Recap {
  const saves = week.filter((s) => s.action === "save");
  const count = (a: RecapSwipe["action"]) => week.filter((s) => s.action === a).length;
  const savedArtists = new Set(saves.map((s) => s.artist.trim().toLowerCase()).filter(Boolean));
  let newArtists = 0;
  for (const a of savedArtists) if (!artistsSavedBefore.has(a)) newArtists++;
  return {
    cards: week.length,
    saves: saves.length,
    skips: count("skip"),
    more: count("more"),
    nevers: count("never"),
    saveRate: week.length ? Math.round((saves.length / week.length) * 100) / 100 : 0,
    newArtists,
    topArtists: topBy(saves.map((s) => s.artist), 3),
    topGenres: topBy(week.filter((s) => s.action !== "skip" && s.action !== "never").map((s) => s.genre), 3),
    savedTrackIds: [...new Set(saves.map((s) => s.trackId))].slice(0, 100),
  };
}
