/**
 * Hook of the day: one song a day, picked for this listener.
 *
 * Picked on the device, not the server. The ranking that knows this listener —
 * taste answers, the locally trained model, the sound vector, the mood of the
 * hour — lives in the client (data/ranking.ts), works for guests, and works
 * offline; a server pick would know less and cost a round trip. The candidates
 * are the deck's own ranked queue, so the pick is "the best thing the deck was
 * about to deal you", minus anything already in your library.
 *
 * Rules: at most one pick per calendar day (today's pick is stable once made),
 * never the same song twice within 30 days, prefer songs whose hook was
 * measured. On the phone the next week of picks is scheduled as local
 * notifications at the listener's chosen time; nothing is sent to a server.
 *
 * Mirrored in mobile/src/lib/hookOfDay.ts (scripts/check-mirrors.mjs).
 */

export type HookPick = { day: string; trackId: string };
export const NO_REPEAT_DAYS = 30;

type Candidate = { id: string; hooks?: unknown[] };

/** Local calendar day, "2026-09-27". */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Keep only what the no-repeat rule still needs. */
export function pruneHistory(history: HookPick[], today: string): HookPick[] {
  return history.filter((h) => daysBetween(h.day, today) < NO_REPEAT_DAYS && daysBetween(h.day, today) >= -14);
}

/**
 * The pick for `day`. An existing pick for that day wins; otherwise the first
 * candidate that isn't excluded and wasn't picked in the last 30 days, with
 * measured hooks preferred.
 */
export function pickForDay<T extends Candidate>(
  candidates: T[],
  history: HookPick[],
  day: string,
  exclude: Set<string> = new Set(),
): T | null {
  const existing = history.find((h) => h.day === day);
  if (existing) {
    const t = candidates.find((c) => c.id === existing.trackId);
    if (t) return t;
  }
  const recent = new Set(
    history.filter((h) => Math.abs(daysBetween(h.day, day)) < NO_REPEAT_DAYS).map((h) => h.trackId),
  );
  const ok = candidates.filter((c) => !exclude.has(c.id) && !recent.has(c.id));
  return ok.find((c) => Array.isArray(c.hooks) && c.hooks.length > 0) ?? ok[0] ?? null;
}

/**
 * Picks for the next `days` days starting at `start`, extending `history`.
 * Used to schedule a week of notifications in one go.
 */
export function planDays<T extends Candidate>(
  candidates: T[],
  history: HookPick[],
  start: Date,
  days: number,
  exclude: Set<string> = new Set(),
): { history: HookPick[]; picks: { day: string; track: T }[] } {
  let h = pruneHistory(history, dayKey(start));
  const picks: { day: string; track: T }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = dayKey(d);
    const t = pickForDay(candidates, h, day, exclude);
    if (!t) break;
    if (!h.some((x) => x.day === day)) h = [...h, { day, trackId: t.id }];
    picks.push({ day, track: t });
  }
  return { history: h, picks };
}

/**
 * When the next `days` notifications fire: at hour:minute local time, starting
 * today if that time hasn't passed yet, otherwise tomorrow.
 */
export function notificationTimes(now: Date, hour: number, minute: number, days: number): Date[] {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (first.getTime() <= now.getTime()) first.setDate(first.getDate() + 1);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
}

/** Times offered in Settings — tap targets, not a native time picker. */
export const HOOK_TIMES: { hour: number; minute: number }[] = [
  { hour: 8, minute: 0 },
  { hour: 12, minute: 30 },
  { hour: 17, minute: 30 },
  { hour: 20, minute: 0 },
  { hour: 22, minute: 0 },
];

/**
 * "8:00 pm" / "रात 8:00" — how a notification time reads in Settings. Hindi
 * says the part of the day instead of am/pm, the way people say it aloud.
 */
export function hookTimeLabel(hour: number, minute: number, lang: "en" | "hi" = "en"): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time = `${h12}:${String(minute).padStart(2, "0")}`;
  if (lang === "hi") {
    const part = hour >= 5 && hour < 12 ? "सुबह" : hour >= 12 && hour < 16 ? "दोपहर" : hour >= 16 && hour < 20 ? "शाम" : "रात";
    return `${part} ${time}`;
  }
  return `${time} ${hour < 12 ? "am" : "pm"}`;
}
