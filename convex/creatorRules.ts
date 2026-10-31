/**
 * Pure rules behind the curator's catalogue view (convex/creators.ts
 * cataloguePage), kept free of Convex so tests can run them directly.
 */

export const CATALOGUE_FILTERS = ["all", "needs-hooks", "drafts", "tagged"] as const;
export type CatalogueFilter = (typeof CATALOGUE_FILTERS)[number];

/** Most cards one page may carry: each card reads its hooks, their counters and its mood tally. */
export const CATALOGUE_PAGE_MAX = 48;
/** Matches taken from each search index (title, artist) for one search. */
export const SEARCH_TAKE = 40;
/** An artist's own tracks come back whole; this only stops a runaway account. */
export const OWNED_CAP = 500;

/** Largest audio file a creator may attach: room for a 19-minute WAV. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
/** attachAudio follows the upload within seconds; a file older than this isn't this upload. */
export const UPLOAD_FRESH_MS = 60 * 60_000;

/**
 * What's wrong with a file a creator wants to attach, or null. `file` is its
 * _storage row. attachAudio used to take any storage id at all: any type, any
 * size, and any existing file (another track's audio, an ad's artwork),
 * which the next replacement then deleted.
 */
export function audioUploadProblem(
  file: { contentType?: string; size: number; _creationTime: number } | null,
  now: number,
): string | null {
  if (!file) return "That upload didn't arrive. Try again.";
  if (now - file._creationTime > UPLOAD_FRESH_MS) return "That upload is too old. Upload the file again.";
  if (!(file.contentType ?? "").toLowerCase().startsWith("audio/")) return "That file isn't audio.";
  if (file.size > MAX_AUDIO_BYTES) return "That file is too big (200 MB at most).";
  return null;
}

/** Title matches first, then artist matches, each track once. */
export function mergeById<T extends { _id: unknown }>(first: T[], second: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of [...first, ...second]) {
    const id = String(t._id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

/** The part of a filter that can be decided from the track row alone. */
export function keepForFilter(track: { hidden?: boolean }, filter: CatalogueFilter): boolean {
  return filter === "drafts" ? track.hidden === true : true;
}

/** The part of a filter that needs the joined hooks and mood tags. */
export function keepJoined(
  track: { hidden?: boolean; hooks: { active: boolean }[]; moods?: unknown[] },
  filter: CatalogueFilter,
): boolean {
  if (filter === "needs-hooks") return track.hooks.filter((h) => h.active).length === 0;
  if (filter === "drafts") return track.hidden === true;
  if (filter === "tagged") return (track.moods?.length ?? 0) > 0;
  return true;
}
