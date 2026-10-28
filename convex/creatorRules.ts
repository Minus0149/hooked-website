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
