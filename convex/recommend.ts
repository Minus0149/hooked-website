import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { requirePermission } from "./security";
import { buildNeighbors, scoreCandidates, topSignals, userVector, type Interaction } from "./collab";
import { runtimeFor } from "./runtime";

/**
 * Where the swipe log stops being an archive and starts being the product.
 *
 * Two halves, split for the same reason `hooks.rerank` is split from the swipe
 * that feeds it. Reading history is expensive and shared; answering one
 * listener is cheap and personal. So:
 *
 *   `rebuild`  — scheduled. Reads the recent log once, writes neighbour lists.
 *   `forMe`    — per listener. A few indexed lookups against those lists.
 *
 * Nothing on the read path computes similarity, and nothing on the write path
 * knows who is asking.
 */

/**
 * How much history one run folds in.
 *
 * A Convex transaction may read a bounded number of documents, and this has to
 * leave room for the neighbour rows it then writes. Newest-first is not just a
 * budget: taste moves, and a model built from this month's swipes describes
 * the catalogue better than one averaging over a year of them.
 */
const LOG_BUDGET = 6_000;

/** Reactions of the asking listener that get to vote. See `topSignals`. */
const VOTES = 40;

/**
 * Spelled out rather than inferred. `refresh` calls `rebuild` through
 * `internal`, and `internal` includes `refresh` — TypeScript will not unpick
 * that circle on its own, and when it gives up it degrades the whole generated
 * api to `any`, which silently unTypes every admin screen.
 */
export type RebuildReport = {
  read: number;
  rated: number;
  linked: number;
  written: number;
  removed: number;
  truncated: boolean;
  computedAt: string;
};

export const rebuild = internalMutation({
  args: {},
  handler: async (ctx): Promise<RebuildReport> => {
    const runtime = await runtimeFor(ctx);

    const rows = await ctx.db
      .query("swipes")
      .withIndex("by_creation_time")
      .order("desc")
      .take(LOG_BUDGET);

    const interactions: Interaction[] = rows.map((r) => ({
      userId: r.userId,
      trackId: r.trackId,
      action: r.action,
    }));

    const model = buildNeighbors(interactions, {
      minRaters: runtime.recsMinRaters,
      minSupport: runtime.recsMinSupport,
    });

    const existing = await ctx.db.query("trackNeighbors").collect();
    const byTrack = new Map(existing.map((row) => [row.trackId, row]));
    const computedAt = new Date().toISOString();

    let written = 0;
    for (const [trackId, neighbors] of model.neighbors) {
      const row = byTrack.get(trackId);
      byTrack.delete(trackId);
      // Same list, same order, same scores: leave the row alone. Every write
      // here invalidates a query some open deck is subscribed to, and an
      // unchanged model should cost nothing.
      if (row && sameList(row.neighbors, neighbors)) continue;
      if (row) await ctx.db.patch(row._id, { neighbors, computedAt });
      else await ctx.db.insert("trackNeighbors", { trackId, neighbors, computedAt });
      written++;
    }

    // Whatever is left in the map no longer has neighbours — a track that was
    // hidden, or one whose support fell below the floor when the log rolled
    // forward. A stale list is worse than no list; it recommends from evidence
    // that has since been withdrawn.
    let removed = 0;
    for (const row of byTrack.values()) {
      await ctx.db.delete(row._id);
      removed++;
    }

    return {
      read: rows.length,
      rated: model.rated,
      linked: model.neighbors.size,
      written,
      removed,
      truncated: model.truncated,
      computedAt,
    };
  },
});

/**
 * Rebuild on demand, from the dashboard.
 *
 * The cron is the real schedule; this exists because "is the recommender doing
 * anything yet?" is otherwise unanswerable. The counts it returns say plainly
 * whether the catalogue has enough listeners to link anything at all — `linked:
 * 0` is the honest state of a young catalogue, not a broken job.
 */
export const refresh = mutation({
  args: {},
  handler: async (ctx): Promise<RebuildReport> => {
    await requirePermission(ctx, "config.manage");
    return await ctx.runMutation(internal.recommend.rebuild, {});
  },
});

function sameList(
  a: { trackId: string; score: number }[],
  b: { trackId: string; score: number }[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].trackId !== b[i].trackId || a[i].score !== b[i].score) return false;
  }
  return true;
}

/**
 * What the catalogue's shared model says about this listener specifically.
 *
 * Returns a sparse list — only tracks the model has an opinion about, which in
 * a young catalogue is often none at all. That emptiness is the designed
 * behaviour, not a failure: the deck adds this to a shuffle it already knows
 * how to build, so nothing here being ready simply leaves the deck as it was.
 *
 * Signed out, this is null. Collaborative filtering needs a history to ask
 * with, and a guest doesn't have one on the server.
 */
export const forMe = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const userId = String(user._id);

    const runtime = await runtimeFor(ctx);
    if (runtime.recsStrength === 0) return { strength: 0, scores: [] };

    const mine = await ctx.db
      .query("swipes")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);

    const vector = topSignals(userVector(mine), VOTES);
    if (vector.size === 0) return { strength: runtime.recsStrength, scores: [] };

    // One indexed read per voting track. Bounded by VOTES, which is why that
    // number exists at all.
    const neighbors = new Map<string, { trackId: string; score: number }[]>();
    for (const trackId of vector.keys()) {
      const row = await ctx.db
        .query("trackNeighbors")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      if (row) neighbors.set(trackId, row.neighbors);
    }

    const scored = [...scoreCandidates(neighbors, vector)]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 200)
      .map(([trackId, score]) => ({ trackId, score }));

    return { strength: runtime.recsStrength, scores: scored };
  },
});
