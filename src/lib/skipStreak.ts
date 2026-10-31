/**
 * "Not feeling these?" — after a run of skips in a row, the deck offers a way
 * out: pick a mood, or start the suggestions fresh. Founder's call, 31 Oct:
 * "if he skips a lot of songs, ask: do you want a new playlist on the mood, or
 * a suggestions reset?"
 *
 * Offered at SKIP_STREAK skips in a row, and again only after another full
 * streak once dismissed, so "keep going" really means keep going.
 */
export const SKIP_STREAK = 10;

/** Skips in a row at the end of the history (any other action breaks the run). */
export function trailingSkips(history: { action: string }[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i].action === "skip"; i--) n++;
  return n;
}

/** `dismissedAt` is the streak length when "keep going" was tapped (0 = never). */
export function offerReset(streak: number, dismissedAt: number): boolean {
  if (streak < SKIP_STREAK) return false;
  if (dismissedAt > 0 && streak >= dismissedAt) return streak - dismissedAt >= SKIP_STREAK;
  return true;
}
