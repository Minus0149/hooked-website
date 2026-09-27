import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { touchCatalog } from "./catalog";
import { runtimeFor } from "./runtime";
import { requirePermission } from "./security";
import { planWindows, playableMs } from "./hooks";
import {
  HOOK_PIPELINE_VERSION,
  measureHooks,
  planHooksV3,
  policyOf,
  type HookAnalysis,
  type HookPolicy,
} from "./hookRules";

/**
 * Hook recognition v3, server side.
 *
 * scripts/analyze-hooks-v3.py listens to each track's audio (music-structure
 * analysis — beats, bars, repeating sections) and posts the ANALYSIS here, not
 * finished windows. The windows are derived from it by hookRules.planHooksV3
 * under the admin's policy, so switching policy re-derives every track without
 * downloading a single preview again.
 */

const analysisValidator = v.object({
  durationMs: v.number(),
  tempo: v.optional(v.number()),
  downbeatsMs: v.array(v.number()),
  sections: v.array(v.object({ startMs: v.number(), endMs: v.number(), label: v.number(), score: v.number() })),
  modelStartMs: v.optional(v.number()),
  confidence: v.number(),
  heuristicStartMs: v.number(),
});

const finite = (n: number, lo: number, hi: number) => Math.min(Math.max(Number.isFinite(n) ? n : lo, lo), hi);

/** Bound everything the analyser sends: it is trusted, but not infallible. */
export function cleanAnalysis(a: HookAnalysis & { tempo?: number }): HookAnalysis & { tempo?: number } {
  const dur = finite(a.durationMs, 1_000, 20 * 60_000);
  return {
    durationMs: Math.round(dur),
    tempo: a.tempo === undefined ? undefined : finite(a.tempo, 20, 300),
    downbeatsMs: a.downbeatsMs.slice(0, 600).map((d) => Math.round(finite(d, 0, dur))).sort((x, y) => x - y),
    sections: a.sections.slice(0, 60).map((s) => ({
      startMs: Math.round(finite(s.startMs, 0, dur)),
      endMs: Math.round(finite(s.endMs, 0, dur)),
      label: Math.round(finite(s.label, 0, 50)),
      score: finite(s.score, -5, 5),
    })),
    modelStartMs: a.modelStartMs === undefined ? undefined : Math.round(finite(a.modelStartMs, 0, dur)),
    confidence: finite(a.confidence, 0, 1),
    heuristicStartMs: Math.round(finite(a.heuristicStartMs, 0, dur)),
  };
}

/** Hooks a machine made (provisional thirds, older analysers, this one). */
const isMachineHook = (createdBy: string) =>
  createdBy === "analyzer" || createdBy.startsWith("analyzer:") || createdBy.startsWith("system:");

/**
 * Replace a track's machine-made hooks with the plan for `policy`. A person's
 * hooks — a creator's marks, a curator's — always win and are never touched.
 */
async function materialize(ctx: MutationCtx, trackId: string, analysis: HookAnalysis, policy: HookPolicy) {
  const hooks = await ctx.db
    .query("hooks")
    .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
    .collect();
  if (hooks.some((h) => h.active && !isMachineHook(h.createdBy))) {
    return { method: "human" as const, written: 0 };
  }
  for (const h of hooks) if (isMachineHook(h.createdBy)) await ctx.db.delete(h._id);
  const plan = planHooksV3(analysis, policy);
  for (const [order, w] of plan.windows.entries()) {
    await ctx.db.insert("hooks", {
      trackId,
      startMs: w.startMs,
      durationMs: w.durationMs,
      order,
      active: true,
      createdBy: `analyzer:v${HOOK_PIPELINE_VERSION}:${plan.method}`,
      source: "curated",
    });
  }
  return { method: plan.method, written: plan.windows.length };
}

/** Store one track's analysis and derive its hooks under the current policy. */
export const ingest = internalMutation({
  // touch=false: the analyser is mid-run and will call touch() itself, so a
  // 3,000-track pass rebuilds the client catalogue a handful of times, not
  // once every 20 s for the length of the run
  args: { trackId: v.string(), analysis: analysisValidator, touch: v.optional(v.boolean()) },
  handler: async (ctx, { trackId, analysis, touch }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", trackId.slice(0, 120)))
      .unique();
    if (!track) return { ok: false as const, reason: "no track" };
    const a = cleanAnalysis(analysis);
    const row = { trackId: track.trackId, version: HOOK_PIPELINE_VERSION, ...a, at: Date.now() };
    const existing = await ctx.db
      .query("hookAnalyses")
      .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
      .unique();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("hookAnalyses", row);

    const policy = policyOf((await runtimeFor(ctx)).hookPolicy);
    const result = await materialize(ctx, track.trackId, a, policy);
    await ctx.db.patch(track._id, { analyzedAt: new Date().toISOString(), hookVersion: HOOK_PIPELINE_VERSION });
    if (touch !== false) await touchCatalog(ctx);
    return { ok: true as const, ...result };
  },
});

/**
 * The audio could not be heard (dead preview URL, undecodable file). Stamp the
 * track so the queue moves on, and give it the provisional plan — the whole
 * preview, or evenly spaced non-overlapping sections — never v2's 10 s thirds.
 */
export const ingestFailed = internalMutation({
  args: { trackId: v.string(), touch: v.optional(v.boolean()) },
  handler: async (ctx, { trackId, touch }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", trackId.slice(0, 120)))
      .unique();
    if (!track) return { ok: false as const, reason: "no track" };
    const hooks = await ctx.db
      .query("hooks")
      .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
      .collect();
    let written = 0;
    if (!hooks.some((h) => h.active && !isMachineHook(h.createdBy))) {
      for (const h of hooks) if (isMachineHook(h.createdBy)) await ctx.db.delete(h._id);
      for (const [order, w] of planWindows(playableMs(track)).entries()) {
        await ctx.db.insert("hooks", {
          trackId: track.trackId,
          startMs: w.startMs,
          durationMs: w.durationMs,
          order,
          active: true,
          createdBy: `analyzer:v${HOOK_PIPELINE_VERSION}:unheard`,
          source: "curated",
        });
        written++;
      }
    }
    await ctx.db.patch(track._id, { hookVersion: HOOK_PIPELINE_VERSION });
    if (written > 0 && touch !== false) await touchCatalog(ctx);
    return { ok: true as const, method: "unheard" as const, written };
  },
});

/** The analyser's "publish what I've written so far" — one catalogue rebuild. */
export const touch = internalMutation({
  args: {},
  handler: async (ctx) => {
    await touchCatalog(ctx);
  },
});

/**
 * Tracks the current pipeline hasn't listened to yet, with a URL to fetch.
 * Index order puts a missing hookVersion first, so `lt` covers never-heard
 * and heard-by-an-older-version alike. Hidden tracks are included (they can be
 * unhidden); storage URLs are minted fresh because they expire.
 */
export const pending = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("tracks")
      .withIndex("by_hookVersion", (q) => q.lt("hookVersion", HOOK_PIPELINE_VERSION))
      .take(Math.min(Math.max(Math.floor(limit), 1), 200));
    const out = [];
    for (const t of rows) {
      const url = t.audioStorageId ? await ctx.storage.getUrl(t.audioStorageId) : t.previewUrl;
      out.push({
        trackId: t.trackId,
        title: t.title,
        artist: t.artist,
        url: url ?? null,
        durationMs: playableMs(t),
      });
    }
    return out;
  },
});

/** Re-derive every analysed track's hooks under the current policy, in batches. */
export const rematerialize = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const policy = policyOf((await runtimeFor(ctx)).hookPolicy);
    const page = await ctx.db.query("hookAnalyses").paginate({ numItems: 80, cursor });
    let changed = 0;
    for (const a of page.page) {
      const r = await materialize(ctx, a.trackId, a, policy);
      if (r.written > 0) changed++;
    }
    if (changed > 0) await touchCatalog(ctx);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.hookPlans.rematerialize, { cursor: page.continueCursor });
    }
    return { changed, done: page.isDone };
  },
});

/** Admin: apply the hook policy chosen in Config to every analysed track. */
export const applyPolicy = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.curate");
    await ctx.scheduler.runAfter(0, internal.hookPlans.rematerialize, { cursor: null });
    return { started: true, policy: policyOf((await runtimeFor(ctx)).hookPolicy) };
  },
});

async function measure(ctx: QueryCtx) {
  const hooks = await ctx.db
    .query("hooks")
    .withIndex("by_active", (q) => q.eq("active", true))
    .collect();
  const heard = await ctx.db
    .query("tracks")
    .withIndex("by_hookVersion", (q) => q.eq("hookVersion", HOOK_PIPELINE_VERSION))
    .collect();
  const waiting = await ctx.db
    .query("tracks")
    .withIndex("by_hookVersion", (q) => q.lt("hookVersion", HOOK_PIPELINE_VERSION))
    .collect();
  return {
    policy: policyOf((await runtimeFor(ctx)).hookPolicy),
    tracksHeard: heard.length,
    tracksWaiting: waiting.length,
    ...measureHooks(hooks),
  };
}

/**
 * How the catalogue's hooks look right now: length distribution, how many
 * tracks replay the same seconds (target 0 %), and which method made them.
 * Reads every active hook, so the admin page asks for it on a button press
 * rather than subscribing.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.curate");
    return measure(ctx);
  },
});

/** The same numbers for the CLI: npx convex run hookPlans:measureNow --prod */
export const measureNow = internalQuery({ args: {}, handler: async (ctx) => measure(ctx) });

/**
 * Put tracks back in the analyser's queue (e.g. ones a flaky network marked
 * unheard): npx convex run --prod hookPlans:forget '{"trackIds":["..."]}'
 */
export const forget = internalMutation({
  args: { trackIds: v.array(v.string()) },
  handler: async (ctx, { trackIds }) => {
    let reset = 0;
    for (const trackId of trackIds.slice(0, 500)) {
      const track = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      if (track && track.hookVersion !== undefined) {
        await ctx.db.patch(track._id, { hookVersion: undefined });
        reset++;
      }
    }
    return { reset };
  },
});
