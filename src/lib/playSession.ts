/**
 * Playing a playlist through the deck.
 *
 * Liked Songs, Discoveries and every playlist can be played (in order, or
 * shuffled) with the same card, player and gestures as discovery: up is next,
 * ↩ is previous, saves are no-ops on songs already kept. The session's songs go
 * to the front of the queue; when they run out the normal deck simply carries
 * on behind them.
 *
 * Two rules keep a session from damaging the library it is playing:
 *  - skipping your own saved song is "next", not a verdict — it never counts
 *    toward the two-skip auto-bury, and it is not written to deck memory;
 *  - the mood lens is switched off while a playlist plays (a lens would
 *    reorder the playlist).
 *
 * Mirrored in mobile/src/lib/playSession.ts (scripts/check-mirrors.mjs).
 */

export type PlaySession = {
  /** "liked" | "discoveries" | "pl:<id>" */
  container: string;
  title: string;
  /** the songs in the order they will be dealt */
  ids: string[];
};

type WithId = { id: string };

function unique<T extends WithId>(tracks: T[]): T[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/**
 * The order a session deals its songs.
 * In order: starting at the tapped song, wrapping round to the ones above it.
 * Shuffled: a fresh shuffle, with the tapped song (if any) first.
 */
export function sessionOrder<T extends WithId>(
  tracks: T[],
  shuffle: boolean,
  startId?: string,
  rand: () => number = Math.random,
): T[] {
  const list = unique(tracks);
  if (!shuffle) {
    const i = startId ? Math.max(0, list.findIndex((t) => t.id === startId)) : 0;
    return [...list.slice(i), ...list.slice(0, i)];
  }
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (startId) {
    const k = a.findIndex((t) => t.id === startId);
    if (k > 0) a.unshift(...a.splice(k, 1));
  }
  return a;
}

/** The session's songs first, then the rest of the deck without repeats. */
export function sessionQueue<T extends WithId>(order: T[], deck: T[]): T[] {
  const ids = new Set(order.map((t) => t.id));
  return [...order, ...deck.filter((t) => !ids.has(t.id))];
}

/** Is this card one of the session's songs? */
export function inSession(session: PlaySession | null, id: string | undefined): boolean {
  return !!session && !!id && session.ids.includes(id);
}

/** "3 / 14" for the pill, or null once the deck has moved past the playlist. */
export function sessionPosition(
  session: PlaySession | null,
  headId: string | undefined,
): { index: number; total: number } | null {
  if (!session || !headId) return null;
  const i = session.ids.indexOf(headId);
  return i < 0 ? null : { index: i + 1, total: session.ids.length };
}

/** The session's songs still waiting in the queue, in queue order. */
export function pendingSession<T extends WithId>(queue: T[], session: PlaySession | null): T[] {
  if (!session) return [];
  const ids = new Set(session.ids);
  return queue.filter((t) => ids.has(t.id));
}

/** Leaving a session: drop its songs, keep the deck. */
export function withoutSession<T extends WithId>(queue: T[], session: PlaySession | null): T[] {
  if (!session) return queue;
  const ids = new Set(session.ids);
  return queue.filter((t) => !ids.has(t.id));
}
