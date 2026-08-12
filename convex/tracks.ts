import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { trackFields } from "./schema";
import {
  cleanText,
  cleanTrack,
  enforceRateLimit,
  requirePermission,
} from "./security";

/**
 * Public feed catalog — hidden tracks are excluded for everyone.
 *
 * Each track carries its hooks, ordered best-first: the window with the highest
 * save rate leads, so the catalogue tunes itself as the counters fill in. Ties
 * and untested hooks fall back to the creator's own order.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("tracks").collect();
    const visible = all.filter((t) => t.hidden !== true);
    return await Promise.all(
      visible.map(async (track) => {
        const hooks = (
          await ctx.db
            .query("hooks")
            .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
            .collect()
        ).filter((h) => h.active);

        // enough plays to mean something, otherwise the creator's order stands
        const rate = (h: { plays: number; saves: number }) =>
          h.plays >= 20 ? h.saves / h.plays : -1;
        hooks.sort((a, b) => rate(b) - rate(a) || a.order - b.order);

        return {
          ...track,
          audioUrl: track.audioStorageId ? await ctx.storage.getUrl(track.audioStorageId) : null,
          hooks: hooks.map((h) => ({
            id: h._id,
            startMs: h.startMs,
            durationMs: h.durationMs,
            label: h.label,
          })),
        };
      }),
    );
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
