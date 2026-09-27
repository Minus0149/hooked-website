/**
 * Rules for the two free-to-listener features that put artists in front of
 * people: the indie hook of the week (convex/featured.ts) and sponsored mood
 * decks (convex/sponsoredDecks.ts). Pure, so they can be tested.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** The Monday (in India's time zone) that starts the week containing `ms`, as YYYY-MM-DD. */
export function weekOf(ms: number): string {
  const ist = new Date(ms + IST_OFFSET_MS);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - dow * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** A week key an admin typed is valid only if it is a real Monday. */
export function isWeekKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCDay() === 1;
}

export const BLURB_MAX = 280;

// ------------------------------------------------------------------ sponsored decks

export type DeckWindow = { active: boolean; startsAt: number; endsAt: number };

/** Live now: switched on, and inside its dates. */
export function deckLive(d: DeckWindow, now: number): boolean {
  return d.active && d.startsAt <= now && now < d.endsAt;
}

/** The label listeners see, always carrying who paid for it (ASCI). */
export function deckLabel(d: { title: string; brand: string }): string {
  return `${d.title} · presented by ${d.brand}`;
}

export type DeckDay = { day: string; impressions: number; opens: number; plays: number };

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The sponsor report: one row per day plus a total, counts only — no listener data exists to leak. */
export function deckCsv(deck: { brand: string; title: string }, days: DeckDay[]): string {
  const rows = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const total = rows.reduce(
    (t, d) => ({ impressions: t.impressions + d.impressions, opens: t.opens + d.opens, plays: t.plays + d.plays }),
    { impressions: 0, opens: 0, plays: 0 },
  );
  const lines = [
    ["brand", "deck", "day", "impressions", "opens", "plays"].join(","),
    ...rows.map((d) => [deck.brand, deck.title, d.day, d.impressions, d.opens, d.plays].map(csvCell).join(",")),
    [deck.brand, deck.title, "total", total.impressions, total.opens, total.plays].map(csvCell).join(","),
  ];
  return lines.join("\n") + "\n";
}

/** Plays counted per listener per deck session — a cap so one bored thumb can't inflate a report. */
export const DECK_PLAYS_PER_SESSION = 25;
