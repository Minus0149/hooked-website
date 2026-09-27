import { v } from "convex/values";
import { query } from "./_generated/server";
import { hooksByTrack } from "./tracks";
import { cleanText } from "./security";

/**
 * One song, for a shared link (hookedcue.com/s/<trackId>).
 *
 * Public on purpose — a share link has to open for anyone — so it returns the
 * same fields the catalogue already publishes, for one visible track. Hidden
 * tracks and unknown ids answer null. The audio is never re-hosted: an iTunes
 * preview is streamed from Apple's own URL, and a creator upload from its
 * storage URL, exactly as the deck does.
 */
export const track = query({
  args: { trackId: v.string() },
  handler: async (ctx, { trackId }) => {
    const id = cleanText(trackId, 120);
    if (!id) return null;
    const t = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", id))
      .unique();
    if (!t || t.hidden === true) return null;
    const hooks = (
      await ctx.db
        .query("hooks")
        .withIndex("by_trackId", (q) => q.eq("trackId", id))
        .collect()
    ).filter((h) => h.active);
    const ordered = hooksByTrack(hooks).get(id) ?? [];
    return {
      trackId: t.trackId,
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: t.artwork,
      genre: t.genre,
      accent: t.accent,
      previewUrl: t.previewUrl,
      audioUrl: t.audioStorageId ? await ctx.storage.getUrl(t.audioStorageId) : null,
      durationMs: t.durationMs,
      hooks: ordered.map((h) => ({ startMs: h.startMs, durationMs: h.durationMs, label: h.label ?? null })),
    };
  },
});
