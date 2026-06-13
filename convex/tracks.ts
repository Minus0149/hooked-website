import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { trackFields } from "./schema";

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
    let inserted = 0;
    for (const track of tracks) {
      const existing = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
        .unique();
      if (!existing) {
        await ctx.db.insert("tracks", track);
        inserted++;
      }
    }
    return { inserted, total: tracks.length };
  },
});

export const setHidden = mutation({
  args: { trackId: v.string(), hidden: v.boolean() },
  handler: async (ctx, { trackId, hidden }) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not signed in");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", String(user._id)))
      .unique();
    const canCurate =
      profile?.isAdmin || (profile?.permissions ?? []).includes("catalog.curate");
    if (!canCurate) throw new Error("Requires catalog.curate permission");
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
      .unique();
    if (track) await ctx.db.patch(track._id, { hidden });
  },
});
