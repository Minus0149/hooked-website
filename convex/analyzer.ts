import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { cleanText } from "./security";

/**
 * Server side of the external hook analyzer.
 *
 * Convex has no audio decoder, so the real analysis lives in
 * scripts/analyze-hooks.mjs — it pulls this catalogue's unanalyzed tracks over
 * HTTP, measures the audio with ffmpeg (loudness, transients and repetition,
 * see scripts/lib/hook-detector.mjs), and posts windows back here.
 *
 * These functions are internal: only http.ts reaches them, and only after the
 * caller has proven it holds HOOK_ANALYZE_KEY.
 */

const MAX_WINDOWS = 6;

/** Tracks still waiting for analysis, in manageable batches. */
export const pendingTracks = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const all = await ctx.db.query("tracks").collect();
    return all
      .filter(
        (t) =>
          t.hidden !== true &&
          t.analyzedAt === undefined &&
          !!t.previewUrl,
      )
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map((t) => ({
        trackId: t.trackId,
        title: t.title,
        artist: t.artist,
        previewUrl: t.previewUrl,
        audioUrl: null as string | null, // storage URLs expire; preview is stable
        durationMs: t.durationMs,
      }));
  },
});

/**
 * Write measured windows for one track.
 *
 * Replaces hooks the system generated before (provisional thirds, previous
 * analyzer runs) but never touches creator-made ones — a human's marking wins
 * over any measurement, including a newer one.
 */
export const ingestHooks = internalMutation({
  args: {
    trackId: v.string(),
    analyzedAt: v.string(),
    windows: v.array(
      v.object({
        startMs: v.number(),
        durationMs: v.number(),
      }),
    ),
  },
  handler: async (ctx, { trackId, analyzedAt, windows }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
      .unique();
    if (!track) return { ok: false as const, reason: "no track" };

    const safeWindows = windows
      .slice(0, MAX_WINDOWS)
      .map((w) => ({
        startMs: Math.max(0, Math.floor(w.startMs)),
        durationMs: Math.min(Math.max(Math.floor(w.durationMs), 5_000), 45_000),
      }))
      .filter((w) => w.startMs + w.durationMs <= (track.audioDurationMs ?? track.durationMs ?? 60_000) + 2_000);
    if (safeWindows.length === 0) return { ok: false as const, reason: "no usable windows" };

    const existing = await ctx.db
      .query("hooks")
      .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
      .collect();
    for (const h of existing) {
      // "system:*" covers system:backfill and system:catalog provisions
      if (h.createdBy === "analyzer" || h.createdBy.startsWith("system:")) {
        await ctx.db.delete(h._id);
      }
    }

    for (const [order, w] of safeWindows.entries()) {
      await ctx.db.insert("hooks", {
        trackId: track.trackId,
        startMs: w.startMs,
        durationMs: w.durationMs,
        order,
        active: true,
        createdBy: "analyzer",
        source: "curated",
      });
    }

    await ctx.db.patch(track._id, { analyzedAt });
    return { ok: true as const, written: safeWindows.length };
  },
});

/** Record that a track was looked at but no usable audio came back. */
export const markAnalyzedEmpty = internalMutation({
  args: { trackId: v.string(), analyzedAt: v.string() },
  handler: async (ctx, { trackId, analyzedAt }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
      .unique();
    if (!track) return;
    await ctx.db.patch(track._id, { analyzedAt });
  },
});
