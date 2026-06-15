import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { trackFields } from "./schema";
import {
  cleanText,
  cleanTrack,
  enforceRateLimit,
  requirePermission,
} from "./security";

/** Public feed catalog — hidden tracks are excluded for everyone. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("tracks").collect();
    return all.filter((t) => t.hidden !== true);
  },
});

/** One-time seed from the baked catalog; safe to re-run (skips existing). */
export const seed = mutation({
  args: { tracks: v.array(v.object(trackFields)) },
  handler: async (ctx, { tracks }) => {
    const { user } = await requirePermission(ctx, "catalog.curate");
    await enforceRateLimit(ctx, `tracks:seed:${user.id}`, 3, 60 * 60_000);
    let inserted = 0;
    for (const track of tracks) {
      const safeTrack = cleanTrack(track);
      const existing = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", safeTrack.trackId))
        .unique();
      if (!existing) {
        await ctx.db.insert("tracks", safeTrack);
        inserted++;
      }
    }
    return { inserted, total: tracks.length };
  },
});

export const setHidden = mutation({
  args: { trackId: v.string(), hidden: v.boolean() },
  handler: async (ctx, { trackId, hidden }) => {
    const { user } = await requirePermission(ctx, "catalog.curate");
    await enforceRateLimit(ctx, `tracks:hide:${user.id}`, 120, 60_000);
    const safeTrackId = cleanText(trackId, 120);
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", safeTrackId))
      .unique();
    if (track) await ctx.db.patch(track._id, { hidden });
  },
});
