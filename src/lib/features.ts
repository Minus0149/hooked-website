/**
 * Labels and small rules for the artist features on Home: the indie hook of
 * the week (convex/featured.ts) and sponsored mood decks
 * (convex/sponsoredDecks.ts).
 *
 * Mirrored in mobile/src/lib/features.ts: what a listener is told about
 * unpaid picks and paid decks must read the same in both apps.
 */

/** Unpaid, chosen by us — never called "promoted". */
export const FEATURED_LABEL = "indie hook of the week";

/** Paid content is marked as such on the content itself (ASCI). */
export const SPONSORED_TAG = "Sponsored";

export function deckLabel(d: { title: string; brand: string }): string {
  return `${d.title} · presented by ${d.brand}`;
}

/** Plays counted per deck session, so one listener can't inflate a sponsor report. */
export const DECK_PLAYS_PER_SESSION = 25;

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The songs a deck plays first: its hand-picked songs that are in the
 * catalogue, then (for a genre deck) catalogue songs of that genre, capped.
 * Order is kept for hand-picked songs; genre fill is taken as given.
 */
export function deckTracks<T extends { id: string; genre: string }>(
  catalog: T[],
  deck: { trackIds: string[]; genre: string | null },
  cap = 12,
): T[] {
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const picked = deck.trackIds.map((id) => byId.get(id)).filter((t): t is T => Boolean(t));
  if (!deck.genre) return picked.slice(0, cap);
  const g = flat(deck.genre);
  const seen = new Set(picked.map((t) => t.id));
  const fill = catalog.filter((t) => !seen.has(t.id) && g && (flat(t.genre).includes(g) || g.includes(flat(t.genre))));
  return [...picked, ...fill].slice(0, cap);
}
