/**
 * Web mirror of the mobile outbox (mobile/src/lib/outbox.ts) — same contract,
 * localStorage instead of AsyncStorage. Cloud mutations that fail (offline,
 * token blip) queue here and drain when the app next has a session and
 * connectivity, so "working simultaneously" survives a dead network.
 */

const KEY = "hooked.outbox.v1";
const MAX_ITEMS = 200;

export type QueuedMutation =
  | { fn: "recordSwipe"; args: Record<string, unknown> }
  | { fn: "revertSwipe"; args: Record<string, unknown> }
  | { fn: "setSaveTarget"; args: Record<string, unknown> }
  | { fn: "removeSong"; args: Record<string, unknown> }
  | { fn: "unburyTrack"; args: Record<string, unknown> }
  | { fn: "unblockArtist"; args: Record<string, unknown> }
  | { fn: "setReplayContainer"; args: Record<string, unknown> }
  | { fn: "setTaste"; args: Record<string, unknown> }
  | { fn: "setPrefs"; args: Record<string, unknown> }
  | { fn: "deletePlaylist"; args: Record<string, unknown> };

export async function enqueue(item: QueuedMutation): Promise<void> {
  try {
    const raw = localStorage.getItem(KEY);
    const list: QueuedMutation[] = raw ? JSON.parse(raw) : [];
    list.push(item);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ITEMS)));
  } catch {
    // storage unavailable — nothing more we can do than drop the write
  }
}

/** Drain the queue through `send`, oldest first. Returns leftovers count. */
export async function flush(
  send: (item: QueuedMutation) => Promise<unknown>,
): Promise<number> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  let list: QueuedMutation[] = [];
  try {
    list = JSON.parse(raw) as QueuedMutation[];
  } catch {
    localStorage.removeItem(KEY);
    return 0;
  }
  if (list.length === 0) return 0;

  const kept: QueuedMutation[] = [];
  while (list.length > 0) {
    const item = list[0];
    try {
      await send(item);
      list.shift();
    } catch {
      break; // still failing — keep everything left for next time
    }
  }
  try {
    if (list.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list.length;
}

