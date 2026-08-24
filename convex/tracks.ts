import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { cleanText, enforceRateLimit, requirePermission } from "./security";

/**
 * Public feed catalog — hidden tracks are excluded for everyone.
 *
 * Each track carries its hooks, ordered best-first: the window with the highest
 * save rate leads, so the catalogue tunes itself as listeners answer. Ties and
 * untested hooks fall back to the creator's own order.
 *
 * Nothing this query reads is written by a swipe. That's deliberate — it is
 * every client's most expensive query, and it should only recompute when the
 * catalogue genuinely changes.
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

        // `rank` is recomputed on a schedule from hookStats (see crons.ts);
        // until a hook has earned one, the creator's own order stands. Reading
        // a stored number rather than live counters is what keeps this query
        // cacheable — see the note on the hookStats table.
        hooks.sort((a, b) => (a.rank ?? a.order) - (b.rank ?? b.order) || a.order - b.order);

        return {
          ...track,
          audioUrl: track.audioStorageId ? await ctx.storage.getUrl(track.audioStorageId) : null,
          hooks: hooks.map((h) => ({
            id: h._id,
            startMs: h.startMs,
            durationMs: h.durationMs,
            label: h.label,
          })),
        };}),
    );
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
