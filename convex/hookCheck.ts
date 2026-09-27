import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requirePermission } from "./security";
import { methodOf, recommendPolicy, scoreMethods } from "./hookRules";

/**
 * The admin "Hook check" page: does hook recognition actually find the hook?
 *
 * A curator listens to a random sample of songs, marks where they hear the
 * hook start and says whether the hook the app plays is good. evaluate()
 * compares those marks with the structure model, the loudness heuristic and
 * "just play the preview from 0". The model is only switched on (runtime
 * hookPolicy) when it wins — see hookRules.recommendPolicy.
 */

const SAMPLE_KEY = "hookCheckSample";
const SAMPLE_SIZE = 30;

async function sampleIds(ctx: QueryCtx): Promise<string[]> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", SAMPLE_KEY))
    .unique();
  return Array.isArray(row?.value) ? (row.value as string[]) : [];
}

/** The songs to label, with everything the page needs to play and judge them. */
export const sample = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.curate");
    const ids = await sampleIds(ctx);
    const out = [];
    for (const trackId of ids) {
      const track = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      if (!track) continue;
      const analysis = await ctx.db
        .query("hookAnalyses")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      const hooks = (
        await ctx.db
          .query("hooks")
          .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
          .collect()
      )
        .filter((h) => h.active)
        .sort((a, b) => a.order - b.order)
        .map((h) => ({ startMs: h.startMs, durationMs: h.durationMs, method: methodOf(h.createdBy) }));
      const label = await ctx.db
        .query("hookLabels")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      const url = track.audioStorageId ? await ctx.storage.getUrl(track.audioStorageId) : track.previewUrl;
      out.push({
        trackId,
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
        url,
        analysis: analysis
          ? {
              durationMs: analysis.durationMs,
              modelStartMs: analysis.modelStartMs,
              confidence: analysis.confidence,
              heuristicStartMs: analysis.heuristicStartMs,
              sections: analysis.sections,
            }
          : null,
        hooks,
        label: label ? { markedStartMs: label.markedStartMs, verdict: label.verdict } : null,
      });
    }
    return out;
  },
});

/**
 * Add SAMPLE_SIZE songs the v3 analyser has heard to the sample, picked at
 * random. Existing picks (and their labels) are kept, so "30 more" extends it.
 */
export const drawSample = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.curate");
    const have = new Set(await sampleIds(ctx));
    const analysed = await ctx.db.query("hookAnalyses").collect();
    const pool = analysed.map((a) => a.trackId).filter((id) => !have.has(id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const next = [...have, ...pool.slice(0, SAMPLE_SIZE)];
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SAMPLE_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: next });
    else await ctx.db.insert("appSettings", { key: SAMPLE_KEY, value: next });
    return { size: next.length, added: next.length - have.size };
  },
});

/** Save a mark and/or verdict for one song. One label per song; latest wins. */
export const label = mutation({
  args: {
    trackId: v.string(),
    markedStartMs: v.optional(v.union(v.number(), v.null())),
    verdict: v.optional(v.union(v.literal("good"), v.literal("bad"), v.null())),
  },
  handler: async (ctx, { trackId, markedStartMs, verdict }) => {
    const { user } = await requirePermission(ctx, "catalog.curate");
    if (!(await sampleIds(ctx)).includes(trackId)) throw new Error("Not in the hook check sample");
    const first = (
      await ctx.db
        .query("hooks")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .collect()
    )
      .filter((h) => h.active)
      .sort((a, b) => a.order - b.order)[0];
    const existing = await ctx.db
      .query("hookLabels")
      .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
      .unique();
    const mark =
      markedStartMs === null
        ? undefined
        : markedStartMs === undefined
          ? existing?.markedStartMs
          : Math.round(Math.min(Math.max(markedStartMs, 0), 20 * 60_000));
    const verdictNext = verdict === null ? undefined : (verdict ?? existing?.verdict);
    const row = {
      trackId,
      markedStartMs: mark,
      verdict: verdictNext,
      // what the verdict was about: the method behind the hook they heard
      method: first ? methodOf(first.createdBy) : undefined,
      by: user.id,
      at: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("hookLabels", row);
    return { ok: true };
  },
});

/** Marks vs methods: mean error, % within 2 s, verdicts, and a recommendation. */
export const evaluate = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.curate");
    const labels = await ctx.db.query("hookLabels").collect();
    const rows = [];
    const verdicts: Record<string, { good: number; bad: number }> = {};
    for (const l of labels) {
      if (l.verdict) {
        const m = l.method ?? "unknown";
        verdicts[m] ??= { good: 0, bad: 0 };
        verdicts[m][l.verdict]++;
      }
      if (l.markedStartMs === undefined) continue;
      const a = await ctx.db
        .query("hookAnalyses")
        .withIndex("by_trackId", (q) => q.eq("trackId", l.trackId))
        .unique();
      if (!a) continue;
      const first = (
        await ctx.db
          .query("hooks")
          .withIndex("by_trackId", (q) => q.eq("trackId", l.trackId))
          .collect()
      )
        .filter((h) => h.active)
        .sort((x, y) => x.order - y.order)[0];
      rows.push({
        markedStartMs: l.markedStartMs,
        modelStartMs: a.modelStartMs,
        confidence: a.confidence,
        heuristicStartMs: a.heuristicStartMs,
        policyStartMs: first?.startMs ?? 0,
      });
    }
    const scores = scoreMethods(rows);
    return {
      labelled: labels.length,
      marked: rows.length,
      scores,
      verdicts,
      recommendation: recommendPolicy(scores),
    };
  },
});
