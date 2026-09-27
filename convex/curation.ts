import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { api, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission } from "./security";
import { touchCatalog } from "./catalog";
import { artistLanguages, curate, langOf, type CurationTrack } from "./catalogRules";
import { lookup, rowOf } from "./charts";

/**
 * The daily pass that decides what the deck may deal (rules: catalogRules.ts).
 *
 * It only ever hides and un-hides, and only its own hides: a song hidden by an
 * admin or a report stays hidden, a song an admin un-hid (`keep`) stays dealt,
 * and artist uploads and listener imports are never touched. Nothing is
 * deleted — a saved song stays in every library that holds it.
 *
 * Reads are paged (the whole table in one query would hit Convex's read limits
 * as the catalogue grows) and writes are batched, then one catalogue rebuild.
 */

const PAGE = 500;
const WRITE_BATCH = 200;
const REPORT_KEY = "curation:lastRun";

type Row = CurationTrack & { _id: Id<"tracks">; lang?: string };

export const page = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const res = await ctx.db.query("tracks").paginate(paginationOpts);
    const rows: Row[] = res.page.map((t) => ({
      _id: t._id,
      trackId: t.trackId,
      title: t.title,
      artist: t.artist,
      genre: t.genre,
      markets: t.markets,
      heat: t.heat,
      releaseDate: t.releaseDate,
      chartedAt: t.chartedAt,
      headlineAt: t.headlineAt,
      hidden: t.hidden,
      hiddenBy: t.hiddenBy,
      keep: t.keep,
      ownerUserId: t.ownerUserId,
      origin: t.origin,
      createdAt: t._creationTime,
      lang: t.lang,
    }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** Each track's language with the whole catalogue's artist hints, where it moved. */
function languagePatches(rows: Row[]): Map<Id<"tracks">, string> {
  const byArtist = artistLanguages(rows);
  const out = new Map<Id<"tracks">, string>();
  for (const t of rows) {
    const lang = langOf(t, byArtist);
    if (lang !== (t.lang ?? "")) out.set(t._id, lang);
  }
  return out;
}

async function writeFills(
  ctx: ActionCtx,
  patches: { id: Id<"tracks">; lang?: string; releaseDate?: string }[],
): Promise<number> {
  let written = 0;
  for (let i = 0; i < patches.length; i += WRITE_BATCH) {
    written += await ctx.runMutation(internal.curation.fill, { patches: patches.slice(i, i + WRITE_BATCH) });
  }
  return written;
}

async function readAll(ctx: ActionCtx): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res: { rows: Row[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
      internal.curation.page,
      { paginationOpts: { numItems: PAGE, cursor } },
    );
    rows.push(...res.rows);
    if (res.isDone) return rows;
    cursor = res.continueCursor;
  }
}

/** Apply decisions: a reason hides (as curation), null un-hides a curation hide. */
export const apply = internalMutation({
  args: {
    decisions: v.array(v.object({ id: v.id("tracks"), reason: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, { decisions }): Promise<number> => {
    let changed = 0;
    for (const d of decisions) {
      const t = await ctx.db.get(d.id);
      // re-checked here: an admin may have acted since the pass read the page
      if (!t || t.keep || t.ownerUserId || (t.hidden && t.hiddenBy !== "curation")) continue;
      if (d.reason) {
        if (t.hidden && t.hiddenReason === d.reason) continue;
        await ctx.db.patch(t._id, { hidden: true, hiddenBy: "curation", hiddenReason: d.reason });
      } else {
        if (!t.hidden) continue;
        await ctx.db.patch(t._id, { hidden: false, hiddenBy: undefined, hiddenReason: undefined });
      }
      changed++;
    }
    if (changed > 0) await touchCatalog(ctx);
    return changed;
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const runtime = await ctx.runQuery(api.runtime.get, {});
    const rows = await readAll(ctx);
    // a chart pull places each new song alone; with the whole catalogue in
    // hand, an artist's other songs can say what language they sing in
    const relabelled = await writeFills(
      ctx,
      [...languagePatches(rows)].map(([id, lang]) => ({ id, lang })),
    );
    const decision = curate(rows, {
      now: Date.now(),
      artistCap: runtime.artistCap,
      staleWeeks: runtime.staleWeeks,
      maxAgeYears: runtime.maxAgeYears,
      oldChartDays: runtime.oldChartDays,
    });

    const byReason: Record<string, number> = {};
    const writes: { id: Id<"tracks">; reason: string | null }[] = [];
    for (const t of rows) {
      if (!decision.has(t.trackId)) continue;
      const reason = decision.get(t.trackId) ?? null;
      if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1;
      const hiddenByUs = t.hidden === true && t.hiddenBy === "curation";
      if (reason ? !t.hidden || hiddenByUs : hiddenByUs) writes.push({ id: t._id, reason });
    }
    let changed = 0;
    for (let i = 0; i < writes.length; i += WRITE_BATCH) {
      changed += await ctx.runMutation(internal.curation.apply, {
        decisions: writes.slice(i, i + WRITE_BATCH),
      });
    }
    const report = {
      at: new Date().toISOString(),
      tracks: rows.length,
      managed: decision.size,
      dealable: [...decision.values()].filter((r) => r === null).length,
      hidden: byReason,
      changed,
      relabelled,
    };
    await ctx.runMutation(internal.curation.saveReport, { value: report });
    return report;
  },
});

export const saveReport = internalMutation({
  args: { value: v.any() },
  handler: async (ctx, { value }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", REPORT_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("appSettings", { key: REPORT_KEY, value });
  },
});

/** Run it now, from the dashboard, without waiting for the schedule. */
export const runNow = mutation({
  args: {},
  handler: async (ctx): Promise<{ started: true }> => {
    await requirePermission(ctx, "catalog.curate");
    await ctx.scheduler.runAfter(0, internal.curation.run, {});
    return { started: true };
  },
});

// ------------------------------------------------------------------ backfill

/**
 * One-off for songs that arrived before language and release dates were kept:
 * place every track's language, and ask Apple for the release date of any
 * chart song missing one. Safe to re-run; it only writes what changed.
 */
export const backfill = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await readAll(ctx);
    const patches: { id: Id<"tracks">; lang?: string; releaseDate?: string }[] = [];
    const needDate = rows.filter((t) => !t.releaseDate && /^\d+$/.test(t.trackId) && !t.ownerUserId);
    const dates = new Map<string, string>();
    for (let i = 0; i < needDate.length; i += 100) {
      for (const r of await lookup(needDate.slice(i, i + 100).map((t) => t.trackId))) {
        const row = rowOf(r);
        if (row.releaseDate) dates.set(row.trackId, row.releaseDate);
      }
      if (i + 100 < needDate.length) await new Promise((r) => setTimeout(r, 1_200));
    }
    const langs = languagePatches(rows);
    for (const t of rows) {
      const lang = langs.get(t._id);
      const releaseDate = dates.get(t.trackId);
      if (lang !== undefined || releaseDate) {
        patches.push({ id: t._id, ...(lang !== undefined ? { lang } : {}), ...(releaseDate ? { releaseDate } : {}) });
      }
    }
    const written = await writeFills(ctx, patches);
    return { tracks: rows.length, looked: needDate.length, dated: dates.size, written };
  },
});

export const fill = internalMutation({
  args: {
    patches: v.array(
      v.object({ id: v.id("tracks"), lang: v.optional(v.string()), releaseDate: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, { patches }): Promise<number> => {
    let n = 0;
    let visible = false;
    for (const p of patches) {
      const t = await ctx.db.get(p.id);
      if (!t) continue;
      await ctx.db.patch(p.id, {
        ...(p.lang !== undefined ? { lang: p.lang } : {}),
        ...(p.releaseDate ? { releaseDate: p.releaseDate } : {}),
      });
      if (p.lang !== undefined && !t.hidden) visible = true;
      n++;
    }
    if (visible) await touchCatalog(ctx);
    return n;
  },
});
