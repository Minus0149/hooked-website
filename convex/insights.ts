import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { emptySkipAt, publicInsights, skipBucket, type InsightRow } from "./insightsRules";
import { cleanText, getProfile, hasPermission, requireUser } from "./security";

/**
 * Free hook insights for artists: counters on their own uploads, kept up to
 * date one swipe at a time (library.recordSwipe calls recordInsight), so the
 * dashboard reads one small row per song and nothing ever scans the swipe
 * log. Only "own:" tracks are counted — chart songs have no artist here to
 * show them to. Arithmetic and privacy floor: convex/insightsRules.ts.
 */

type Action = "skip" | "save" | "more" | "never";

/** Called by recordSwipe after it stores the swipe. Cheap for everything that isn't an upload. */
export async function recordInsight(
  ctx: MutationCtx,
  opts: { trackId: string; userId: string; action: Action; atMs?: number; mood?: string },
): Promise<void> {
  if (!opts.trackId.startsWith("own:")) return;
  const row = await ctx.db
    .query("trackInsights")
    .withIndex("by_trackId", (q) => q.eq("trackId", opts.trackId))
    .unique();
  const seen = await ctx.db
    .query("insightListeners")
    .withIndex("by_track_user", (q) => q.eq("trackId", opts.trackId).eq("userId", opts.userId))
    .unique();
  const base: InsightRow = row ?? {
    listeners: 0,
    plays: 0,
    saves: 0,
    skips: 0,
    more: 0,
    never: 0,
    skipAt: emptySkipAt(),
    moods: {},
    genres: {},
  };
  const next: InsightRow = {
    ...base,
    skipAt: [...base.skipAt],
    moods: { ...base.moods },
    genres: { ...base.genres },
  };
  next.plays += 1;
  if (opts.action === "save") next.saves += 1;
  if (opts.action === "skip") next.skips += 1;
  if (opts.action === "more") next.more += 1;
  if (opts.action === "never") next.never += 1;
  if (opts.action === "skip" && opts.atMs !== undefined) next.skipAt[skipBucket(opts.atMs)] += 1;
  const mood = opts.mood ? cleanText(opts.mood, 20) : "";
  if (mood) next.moods[mood] = (next.moods[mood] ?? 0) + 1;
  if (!seen) {
    // a listener counts once, and so do the genres they said they like
    await ctx.db.insert("insightListeners", { trackId: opts.trackId, userId: opts.userId });
    next.listeners += 1;
    const profile = await getProfile(ctx, opts.userId);
    for (const g of (profile?.taste?.genres ?? []).slice(0, 8)) {
      const key = cleanText(g, 30);
      if (key) next.genres[key] = (next.genres[key] ?? 0) + 1;
    }
  }
  const value = { ...next, updatedAt: Date.now() };
  if (row) await ctx.db.patch(row._id, value);
  else await ctx.db.insert("trackInsights", { trackId: opts.trackId, ...value });
}

/** One song's insights, for the artist who uploaded it (or a curator). */
export const forTrack = query({
  args: { trackId: v.string() },
  handler: async (ctx, { trackId }) => {
    const user = await requireUser(ctx);
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
      .unique();
    if (!track) return null;
    const profile = await getProfile(ctx, user.id);
    if (track.ownerUserId !== user.id && !hasPermission(profile, "catalog.curate")) return null;
    const row = await ctx.db
      .query("trackInsights")
      .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
      .unique();
    return publicInsights(row);
  },
});
