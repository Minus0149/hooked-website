/**
 * How a card's hooks are played. Mirrored in mobile/src/lib/hookPlayback.ts
 * (mobile/scripts/check-mirrors.mjs fails if the two copies drift), so the
 * phone and the browser play the same seconds of the same song.
 *
 * Hook recognition v3 (web/docs/HOOKS.md) sends one window for a preview —
 * from the hook to the end of the audio — and up to three distinct sections
 * for a full upload. Two rules keep playback honest whatever the data says:
 *
 *   - a window never runs past the end of the audio (a 30 s window on a
 *     29.7 s preview used to leave the bar stuck short of full), and
 *   - a window that overlaps one already in the list is dropped, so a song
 *     never replays the same seconds (v2 did that on 76 % of tracks).
 */
export type PlayWindow = { startMs: number; durationMs: number };

/** Keep the running order; drop any window that shares a moment with an earlier one. */
export function distinctHooks<T extends PlayWindow>(hooks: T[]): T[] {
  const kept: T[] = [];
  for (const h of hooks) {
    const end = h.startMs + h.durationMs;
    if (kept.some((k) => h.startMs < k.startMs + k.durationMs && k.startMs < end)) continue;
    kept.push(h);
  }
  return kept;
}

/**
 * Seconds into the current window, and how long it runs. `duration` is the
 * whole file in seconds (0 or NaN while it loads). An open-ended window (the
 * whole-song fallback) borrows the file's length; a measured one is cut at it.
 */
export function hookTiming(hook: PlayWindow, currentTime: number, duration: number) {
  const startS = hook.startMs / 1000;
  const known = Number.isFinite(duration) && duration > 0;
  const fileLeft = known ? Math.max(duration - startS, 0.001) : Number.POSITIVE_INFINITY;
  const own = Number.isFinite(hook.durationMs) ? hook.durationMs / 1000 : Number.POSITIVE_INFINITY;
  const bounded = Math.min(own, fileLeft);
  const into = currentTime - startS;
  // no length yet (an open window before the file's duration loads): never "done"
  if (!Number.isFinite(bounded)) {
    return { startS, lengthS: bounded, into, progress: 0, remaining: bounded, done: false };
  }
  const lengthS = Math.max(bounded, 0.001);
  return {
    startS,
    lengthS,
    into,
    progress: Math.min(Math.max(into / lengthS, 0), 1),
    remaining: Math.max(lengthS - into, 0),
    done: into >= lengthS,
  };
}
