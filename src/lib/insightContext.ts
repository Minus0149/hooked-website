/**
 * What a swipe tells an artist's free hook insights (convex/insights.ts):
 * how far into the hook it came and which mood lens was on. Both optional —
 * the server stores only counts, never who swiped.
 *
 * Mirrored in mobile/src/lib/insightContext.ts.
 */
export function insightContext(
  hookDurationMs: number | undefined,
  progress: number,
  mood: string | null,
): { atMs?: number; mood?: string } {
  const out: { atMs?: number; mood?: string } = {};
  // the player's "whole preview" fallback has no length (Infinity): no position then
  if (hookDurationMs && Number.isFinite(hookDurationMs) && Number.isFinite(progress) && progress >= 0) {
    out.atMs = Math.round(Math.min(progress, 1) * hookDurationMs);
  }
  if (mood) out.mood = mood;
  return out;
}
