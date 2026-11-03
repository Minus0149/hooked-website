/**
 * Where the playhead is, kept OUTSIDE React state.
 *
 * `timeupdate` fires ~4 times a second. When progress lived in usePlayer's
 * state, every tick re-rendered App (1,600 lines) and the whole SwipeDeck,
 * including the card under the user's thumb, so on an iPhone a re-render
 * routinely landed in the middle of a swipe and the drag stuttered. Now only
 * the small parts that draw the playhead subscribe (the hook dots, the scrub
 * bar), and the "keep listening" chip subscribes to a yes/no that changes once
 * per song.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

export type ClockState = { progress: number; remaining: number };

export interface PlayerClock {
  get(): ClockState;
  set(next: Partial<ClockState>): void;
  subscribe(listener: () => void): () => void;
}

export function createPlayerClock(): PlayerClock {
  let state: ClockState = { progress: 0, remaining: Infinity };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const merged = { ...state, ...next };
      if (merged.progress === state.progress && merged.remaining === state.remaining) return;
      state = merged;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The playhead, re-rendering the caller on every tick. Use in small leaves only. */
export function useClock(clock: PlayerClock): ClockState {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

/**
 * A value derived from the playhead; the caller re-renders only when that
 * value changes (e.g. "five seconds left" flips once per song, not 4x a second).
 * `select` must return a primitive.
 */
export function useClockSelect<T extends string | number | boolean | null>(clock: PlayerClock, select: (s: ClockState) => T): T {
  const sel = useRef(select);
  sel.current = select;
  const get = useCallback(() => sel.current(clock.get()), [clock]);
  return useSyncExternalStore(clock.subscribe, get, get);
}
