/**
 * The crowd reveal: after you save or skip a song, see how everyone else
 * judged it, and whether you went with the crowd. A small game on top of the
 * swipe (founder's idea, 31 Oct): a streak counts how many times in a row you
 * called it the way most people did.
 *
 * The counts come from convex/verdicts.ts and exclude your own swipe, so the
 * numbers are "everyone else".
 */
export type CrowdStats = { listeners: number; saves: number; skips: number };
export type Verdict = "save" | "skip";

/** Below this many other listeners there's no crowd to compare with yet. */
export const MIN_CROWD = 3;

export type Reveal =
  | { kind: "first"; mine: Verdict }
  | { kind: "crowd"; mine: Verdict; savePct: number; skipPct: number; withCrowd: boolean; others: number };

/** A swipe as a verdict: right ("more like this") counts as a save, left ("never") as a skip. */
export function verdictOf(action: string): Verdict | null {
  if (action === "save" || action === "more") return "save";
  if (action === "skip" || action === "never") return "skip";
  return null;
}

export function crowdReveal(stats: CrowdStats | null | undefined, mine: Verdict): Reveal {
  const decided = stats ? stats.saves + stats.skips : 0;
  if (!stats || decided < MIN_CROWD) return { kind: "first", mine };
  const savePct = Math.round((stats.saves / decided) * 100);
  const skipPct = 100 - savePct;
  // a dead heat counts as with the crowd either way
  const withCrowd = mine === "save" ? stats.saves >= stats.skips : stats.skips >= stats.saves;
  return { kind: "crowd", mine, savePct, skipPct, withCrowd, others: decided };
}

/** Matching the crowd extends the streak; going against it, or no crowd yet, leaves it / resets it. */
export function nextStreak(streak: number, reveal: Reveal): number {
  if (reveal.kind === "first") return streak;
  return reveal.withCrowd ? streak + 1 : 0;
}
