/**
 * Promoted songs in the deck — paid for by an artist (convex/promotions.ts,
 * docs/PROMOTIONS.md). The card is a normal, playable card; these rules decide
 * when one is asked for, where it goes in the queue, and how it is labelled.
 *
 * Mirrored in mobile/src/lib/promoted.ts: both apps must pace and label paid
 * content identically.
 */

/** India's advertising code (ASCI) wants paid content marked on the content itself. */
export const PROMOTED_LABEL = "Promoted";

/** Said wherever someone asks why they saw it. */
export const PROMOTED_WHY =
  "An independent artist paid to have this song heard. It's labelled so you always know. Turn promoted songs off in Settings → Support.";

/** A listen counts from here, once per listener per campaign (server-side too). */
export const PROMOTED_LISTEN_MS = 3_000;

/** Swipes between promoted songs when the server hasn't said (it usually has). */
export const DEFAULT_EVERY_N_CARDS = 10;

/**
 * Time to ask the server for a promoted song? Never for someone who turned
 * sponsored cards off, and never more often than every N swipes. The server
 * still decides — caps, and whether anything is running at all.
 */
export function promotedDue(opts: { swipesSince: number; everyNCards: number; optedOut: boolean }): boolean {
  if (opts.optedOut) return false;
  return opts.swipesSince >= Math.max(4, opts.everyNCards || DEFAULT_EVERY_N_CARDS);
}

/**
 * Put the promoted song next in line: behind the card on screen (never
 * yank what someone is listening to), and only once in the queue.
 */
export function insertPromoted<T extends { id: string }>(queue: T[], track: T): T[] {
  const [head, ...rest] = queue;
  if (!head) return [track];
  if (head.id === track.id) return queue;
  return [head, track, ...rest.filter((t) => t.id !== track.id)];
}

export type SwipeKind = "up" | "down" | "right" | "left";

/** The outcome an artist sees for a swipe on their promoted song. */
export function promotedOutcome(dir: SwipeKind): "skip" | "save" | "more" | "never" {
  return dir === "down" ? "save" : dir === "right" ? "more" : dir === "left" ? "never" : "skip";
}

/**
 * A promoted song waits next in line until it plays. Some things rebuild the
 * queue behind the card on screen — a new catalogue arriving, a mood picked,
 * signing in — and would silently drop it: the listener was "shown" it on the
 * server, so it would never come back and the artist loses that listener.
 * "reinject" puts it back; "clear" once it has reached the screen.
 */
export function promotedFollowUp(queueIds: string[], pendingId: string | null): "clear" | "reinject" | "wait" {
  if (!pendingId) return "wait";
  if (queueIds[0] === pendingId) return "clear";
  return queueIds.includes(pendingId) ? "wait" : "reinject";
}
