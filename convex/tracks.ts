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
/**
 * Each track's active hooks, best first, from ONE read of the hooks table.
 *
 * list() used to run a separate index query per track — 2,573 of them on the
 * live catalogue — and its first run after any catalogue change took up to
 * two and a half minutes, holding up every connected client's websocket (a
 * guest's own actions sat unconfirmed behind it). One read of the active
 * hooks, grouped here, gives the same answer.
 */
export function hooksByTrack<H extends { trackId: string; order: number; rank?: number }>(
  hooks: H[],
): Map<string, H[]> {
  const by = new Map<string, H[]>();
  for (const h of hooks) {
    const list = by.get(h.trackId);
    if (list) list.push(h);
    else by.set(h.trackId, [h]);
  }
  // `rank` is recomputed on a schedule from hookStats (see crons.ts); until a
  // hook has earned one, the creator's own order stands. Reading a stored
  // number rather than live counters is what keeps this query cacheable — see
  // the note on the hookStats table.
  for (const list of by.values()) {
    list.sort((a, b) => (a.rank ?? a.order) - (b.rank ?? b.order) || a.order - b.order);
  }
  return by;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const [all, activeHooks] = await Promise.all([
      ctx.db.query("tracks").collect(),
      ctx.db
        .query("hooks")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect(),
    ]);
    const byTrack = hooksByTrack(activeHooks);
    const visible = all.filter((t) => t.hidden !== true);
    return await Promise.all(
      visible.map(async (track) => {
        const hooks = byTrack.get(track.trackId) ?? [];
        return {
          // explicit field list rather than a spread: the row carries
          // ownerUserId and storage ids that public clients have no business
          // reading, and a schema addition shouldn't silently become a leak
          trackId: track.trackId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          artwork: track.artwork,
          previewUrl: track.previewUrl,
          durationMs: track.durationMs,
          genre: track.genre,
          accent: track.accent,
          markets: track.markets,
          heat: track.heat,
          energy: track.energy,
          sound: track.sound,
          audioMood: track.audioMood,
          vocal: track.vocal,
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
