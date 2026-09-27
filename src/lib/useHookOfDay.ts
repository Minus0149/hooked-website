import { useEffect, useMemo, useState } from "react";
import type { Track } from "../types";
import { dayKey, pickForDay, pruneHistory, type HookPick } from "./hookOfDay";

/**
 * Today's hook of the day in this browser (see lib/hookOfDay.ts for the rules).
 * The history lives in localStorage — it is only a "don't repeat" memory — and
 * the Home card can be hidden in Settings → Playback.
 */
const HISTORY_KEY = "hooked.hotd.history";
const SHOW_KEY = "hooked.hotd.home";

function readHistory(): HookPick[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((h) => h && typeof h.day === "string" && typeof h.trackId === "string") : [];
  } catch {
    return [];
  }
}

export function readHookOfDayShown(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeHookOfDayShown(on: boolean) {
  try {
    localStorage.setItem(SHOW_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * @param ranked the deck's ranked queue — "the best thing it was about to deal you"
 * @param catalog every track, to find today's pick again once it has left the queue
 * @param exclude songs already in the library
 */
export function useHookOfDay(ranked: Track[], catalog: Track[], exclude: Set<string>): Track | null {
  const [history, setHistory] = useState<HookPick[]>(readHistory);
  const today = dayKey(new Date());

  const pick = useMemo(() => {
    const existing = history.find((h) => h.day === today);
    if (existing) {
      const t = catalog.find((c) => c.id === existing.trackId) ?? ranked.find((c) => c.id === existing.trackId);
      if (t) return t;
    }
    // the first stretch of the ranked deck is what the listener would hear next (the phone schedules from the same slice)
    return pickForDay(ranked.slice(1, 120), history, today, exclude);
  }, [history, today, catalog, ranked, exclude]);

  useEffect(() => {
    if (!pick || history.some((h) => h.day === today)) return;
    const next = [...pruneHistory(history, today), { day: today, trackId: pick.id }];
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* private mode: today's pick just isn't remembered */
    }
  }, [pick, history, today]);

  return pick;
}
