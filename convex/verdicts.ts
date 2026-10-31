import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * How everyone else judged a song: the "crowd reveal" after a swipe
 * (src/lib/crowdReveal.ts). Counts only, summed over the song's hooks from
 * hookStats, which library.recordSwipe credits once per signed-in listener per
 * hook per day. Nothing about who.
 */
export type CrowdStats = { listeners: number; saves: number; skips: number };

export function sumStats(rows: { plays: number; saves: number; skips: number }[]): CrowdStats {
  let listeners = 0;
  let saves = 0;
  let skips = 0;
  for (const r of rows) {
    listeners += r.plays;
    saves += r.saves;
    skips += r.skips;
  }
  return { listeners, saves, skips };
}

export const forTrack = query({
  args: { trackId: v.string() },
  handler: async (ctx, { trackId }): Promise<CrowdStats> => {
    if (trackId.length > 120) return { listeners: 0, saves: 0, skips: 0 };
    const rows = await ctx.db
      .query("hookStats")
      .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
      .take(20); // a song has a handful of hooks
    return sumStats(rows);
  },
});
