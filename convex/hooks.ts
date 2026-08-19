import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { enforceRateLimit, requirePermission } from "./security";

/**
 * Hooks for songs nobody has marked by hand.
 *
 * Every track in the deck should offer more than one way in. A song imported
 * from a playlist, or seeded from the charts, arrives with no hooks at all and
 * would otherwise play as one undifferentiated 30-second block.
 *
 * What we can do here is limited by what we hold: an iTunes preview is 30
 * seconds, so "three distinct parts of the song" really means three distinct
 * parts of the preview. The catalogue builder does better — it decodes the
 * audio with ffmpeg and leads with the loudest part — but Convex has no
 * decoder, so this places the windows evenly and lets the save-rate sort in
 * tracks.list work out the running order from real listeners.
 */

/** What an iTunes/Deezer preview gives you, whatever the song's length. */
const PREVIEW_MS = 30_000;
const HOOK_COUNT = 3;
const MIN_HOOK_MS = 6_000;
const MAX_HOOK_MS = 15_000;

/**
 * Evenly spaced, non-overlapping windows across the playable audio. Distinct
 * parts, so tapping through never replays the same seconds.
 */
export function planWindows(totalMs: number, count = HOOK_COUNT) {
  const total = Math.max(0, Math.floor(totalMs));
  if (total < MIN_HOOK_MS * 2) {
    return [{ startMs: 0, durationMs: Math.max(total, MIN_HOOK_MS) }];
  }
  const windowMs = Math.min(MAX_HOOK_MS, Math.floor(total / count));
  if (windowMs < MIN_HOOK_MS) return [{ startMs: 0, durationMs: total }];

  const stride = Math.floor((total - windowMs) / (count - 1));
  return Array.from({ length: count }, (_, i) => ({
    startMs: i * stride,
    durationMs: windowMs,
  }));
}

/** How much of a track is actually playable — an upload's length, or a preview. */
export function playableMs(track: {
  audioStorageId?: unknown;
  audioDurationMs?: number;
  durationMs?: number;
}) {
  if (track.audioStorageId) return track.audioDurationMs ?? track.durationMs ?? PREVIEW_MS;
  return PREVIEW_MS;
}

/**
 * Give every hookless track three windows. Safe to re-run — a track that
 * already has an active hook is left exactly as its creator arranged it.
 */
export const backfill = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const { user } = await requirePermission(ctx, "catalog.curate");
    await enforceRateLimit(ctx, `hooks:backfill:${user.id}`, 20, 60 * 60_000);

    const cap = Math.min(Math.max(limit ?? 300, 1), 500);
    const tracks = await ctx.db.query("tracks").collect();

    let filled = 0;
    let created = 0;
    for (const track of tracks) {
      if (filled >= cap) break;
      const existing = await ctx.db
        .query("hooks")
        .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
        .collect();
      if (existing.some((h) => h.active)) continue;

      for (const [order, w] of planWindows(playableMs(track)).entries()) {
        await ctx.db.insert("hooks", {
          trackId: track.trackId,
          startMs: w.startMs,
          durationMs: w.durationMs,
          order,
          active: true,
          createdBy: "system:backfill",
          source: "curated",
        });
        created++;
      }
      filled++;
    }

    return { tracksFilled: filled, hooksCreated: created, remaining: tracks.length - filled };
  },
});

/**
 * Turn play counts into a running order.
 *
 * Called on a schedule rather than on every swipe. A swipe writes one small
 * hookStats row; this is the only thing that touches the hook rows the
 * catalogue query reads, so the expensive invalidation happens hourly instead
 * of thousands of times an hour.
 *
 * A hook needs real evidence before it is allowed to jump the queue — below
 * that, the order its creator chose stands.
 */
const ENOUGH_PLAYS = 20;

export const rerank = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db.query("hookStats").collect();
    if (stats.length === 0) return { tracks: 0, changed: 0 };

    const byTrack = new Map<string, typeof stats>();
    for (const s of stats) {
      const list = byTrack.get(s.trackId) ?? [];
      list.push(s);
      byTrack.set(s.trackId, list);
    }

    let changed = 0;
    for (const [trackId, rows] of byTrack) {
      const hooks = await ctx.db
        .query("hooks")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .collect();
      if (hooks.length < 2) continue;

      const rateOf = new Map(
        rows.map((r) => [
          String(r.hookId),
          r.plays >= ENOUGH_PLAYS ? r.saves / r.plays : -1,
        ]),
      );

      const ordered = [...hooks].sort((a, b) => {
        const ra = rateOf.get(String(a._id)) ?? -1;
        const rb = rateOf.get(String(b._id)) ?? -1;
        return rb - ra || a.order - b.order;
      });

      for (const [rank, hook] of ordered.entries()) {
        // only write when it actually moved, so an unchanged catalogue costs
        // nothing and leaves the query cache alone
        if (hook.rank !== rank) {
          await ctx.db.patch(hook._id, { rank });
          changed++;
        }
      }
    }
    return { tracks: byTrack.size, changed };
  },
});
