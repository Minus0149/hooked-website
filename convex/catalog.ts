import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encodeCatalog, type CatalogTrack, type CatalogVersion } from "../src/lib/catalogCodec";
import { hooksByTrack } from "./tracks";
import { runtimeFor } from "./runtime";
import { cdnConfig, pruneVersions, uploadVersion } from "./catalogCdn";

/**
 * The catalogue as a versioned file instead of a reactive query.
 *
 * tracks.list sent every client ~2.2 MB as the first message on its websocket;
 * when that stalled, everything queued behind it on the same socket waited
 * (the admin button, a report, sign-in's profile check). Now:
 *
 *  - anything that changes what clients see of the catalogue calls
 *    touchCatalog(), which only bumps a counter and schedules ONE rebuild a
 *    little later, so an analyser batch of 500 writes is one rebuild, not 500;
 *  - the rebuild reads the catalogue once, encodes it compactly
 *    (src/lib/catalogCodec.ts) as parts of ROWS_PER_PART tracks, stores each
 *    part as a file, and only then advances `version`;
 *  - clients subscribe to catalog:version ({ v, parts }) and fetch the parts
 *    in parallel over plain HTTP by version (GET /catalog?v=N&part=i in
 *    http.ts), caching them — a warm start downloads nothing. The HTTP layer
 *    gzips responses on its own (the action runtime has no CompressionStream).
 *  - each version is also uploaded to Cloudflare R2 (catalogCdn.ts); when that
 *    copy serves the app, version carries its address as `cdn` and clients
 *    read it there first, Convex's copy being the fallback.
 *
 * See docs/CATALOG.md for the numbers.
 */

const KEY = "catalog";
/** How soon an urgent change (an admin hide, a creator publishing) is rebuilt. */
export const REBUILD_DELAY_MS = 20_000;

/**
 * When the next rebuild should run. Background changes (analyser, chart pull,
 * curation, hourly heat) wait until `minIntervalMs` after the last build, so a
 * day of them costs one or two builds instead of thousands; urgent ones go in
 * REBUILD_DELAY_MS.
 */
export function rebuildDelayMs(o: { now: number; builtAt?: number; minIntervalMs: number; urgent?: boolean }): number {
  if (o.urgent || o.builtAt === undefined) return REBUILD_DELAY_MS;
  const due = o.builtAt + o.minIntervalMs;
  return Math.max(REBUILD_DELAY_MS, due - o.now);
}

async function metaRow(ctx: { db: QueryCtx["db"] }) {
  return await ctx.db
    .query("catalogMeta")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
}

/**
 * Call after any write that changes what clients see: a track added, removed,
 * hidden or re-described (title, artwork, energy, sound…), or a hook added,
 * moved, re-ranked or removed.
 */
export async function touchCatalog(ctx: MutationCtx, opts: { urgent?: boolean } = {}): Promise<void> {
  const now = Date.now();
  const meta = await metaRow(ctx);
  if (!meta) {
    await ctx.db.insert("catalogMeta", {
      key: KEY,
      version: 0,
      dirtySeq: 1,
      builtSeq: 0,
      scheduled: true,
      scheduledFor: now + REBUILD_DELAY_MS,
    });
    await ctx.scheduler.runAfter(REBUILD_DELAY_MS, internal.catalog.rebuild, {});
    return;
  }
  const runtime = await runtimeFor(ctx);
  const delay = rebuildDelayMs({
    now,
    builtAt: meta.builtAt,
    minIntervalMs: runtime.catalogRebuildHours * 3_600_000,
    urgent: opts.urgent,
  });
  const when = now + delay;
  // a rebuild is already pending: only an earlier one (an urgent change) is worth scheduling
  const pendingAt = meta.scheduled ? meta.scheduledFor ?? now : Infinity;
  const schedule = !meta.scheduled || when < pendingAt - 1_000;
  await ctx.db.patch(meta._id, {
    dirtySeq: meta.dirtySeq + 1,
    scheduled: true,
    ...(schedule ? { scheduledFor: when } : {}),
  });
  if (schedule) await ctx.scheduler.runAfter(delay, internal.catalog.rebuild, {});
}

/** The tiny thing every client watches. v = 0: no file built yet. */
export const version = query({
  args: {},
  handler: async (ctx): Promise<CatalogVersion> => {
    const meta = await metaRow(ctx);
    const parts = meta?.partIds?.length ?? 0;
    if (!(parts > 0 && meta)) return { v: 0, parts: 0 };
    return meta.cdn ? { v: meta.version, parts, cdn: meta.cdn } : { v: meta.version, parts };
  },
});

/** What the HTTP route needs to serve one part of the current file. */
export const current = internalQuery({
  args: { part: v.number() },
  handler: async (ctx, { part }) => {
    const meta = await metaRow(ctx);
    const ids = meta?.partIds ?? [];
    if (!meta || ids.length === 0) return null;
    return { version: meta.version, parts: ids.length, fileId: ids[part] ?? null };
  },
});

/**
 * Tracks per snapshot page. One query reading the whole table grew toward
 * Convex's per-query read limits (8 MB / 16k documents) as the chart pull
 * started keeping more songs; pages keep every read small whatever the size.
 */
const SNAPSHOT_PAGE = 400;

/** The dirty counter and version at the start of a build, so publish knows what it covered. */
export const snapshotStart = internalQuery({
  args: {},
  handler: async (ctx) => {
    const meta = await metaRow(ctx);
    return { seq: meta?.dirtySeq ?? 0, version: meta?.version ?? 0, builtSeq: meta?.builtSeq ?? 0 };
  },
});

/**
 * One page of what a client needs. Same selection and hook order as
 * tracks.list (kept for app builds that predate this); hooks are read per
 * track by index rather than all at once, for the same reason as the paging.
 */
export const snapshotPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("tracks").paginate(paginationOpts);
    const tracks: CatalogTrack[] = [];
    for (const t of page.page) {
      if (t.hidden === true) continue;
      const hooks = await ctx.db
        .query("hooks")
        .withIndex("by_trackId", (q) => q.eq("trackId", t.trackId))
        .collect();
      const active = hooksByTrack(hooks.filter((h) => h.active)).get(t.trackId) ?? [];
      tracks.push({
        trackId: t.trackId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        artwork: t.artwork,
        previewUrl: t.previewUrl,
        durationMs: t.durationMs,
        genre: t.genre,
        accent: t.accent,
        markets: t.markets,
        heat: t.heat,
        energy: t.energy,
        sound: t.sound,
        audioMood: t.audioMood,
        vocal: t.vocal,
        audioUrl: t.audioStorageId ? await ctx.storage.getUrl(t.audioStorageId) : null,
        lang: t.lang,
        hooks: active.map((h) => ({
          id: h._id,
          startMs: h.startMs,
          durationMs: h.durationMs,
          ...(h.label ? { label: h.label } : {}),
        })),
      });
    }
    return { tracks, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Build the file for the next version. Scheduled by touchCatalog; safe to run by hand. */
export const rebuild = internalAction({
  args: {},
  handler: async (ctx): Promise<{ version: number; parts: number; bytes: number; cdn: boolean } | null> => {
    const snap = await ctx.runQuery(internal.catalog.snapshotStart, {});
    // several rebuilds can be pending (an urgent one brought forward); the
    // later ones find nothing new and cost nothing
    if (snap.version > 0 && snap.seq <= snap.builtSeq) return null;
    const tracks: CatalogTrack[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: { tracks: CatalogTrack[]; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.catalog.snapshotPage, {
          paginationOpts: { numItems: SNAPSHOT_PAGE, cursor },
        });
      tracks.push(...page.tracks);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    const next = snap.version + 1;
    const docs = encodeCatalog(tracks, next);
    const bodies = docs.map((doc) => JSON.stringify(doc));
    const partIds: Id<"_storage">[] = [];
    let bytes = 0;
    for (const body of bodies) {
      const blob = new Blob([body], { type: "application/json" });
      bytes += blob.size;
      partIds.push(await ctx.storage.store(blob));
    }
    const cfg = cdnConfig(process.env);
    const cdn = cfg ? await uploadVersion(cfg, next, bodies) : null;
    const published = await ctx.runMutation(internal.catalog.publish, {
      version: next,
      seq: snap.seq,
      partIds,
      bytes,
      tracks: tracks.length,
      ...(cdn ? { cdn } : {}),
    });
    if (!published) {
      for (const id of partIds) await ctx.storage.delete(id);
      return null;
    }
    // the previous version stays for a client mid-download, like the Convex copy
    if (cfg) await pruneVersions(cfg, next - 1);
    return { version: next, parts: partIds.length, bytes, cdn: cdn !== null };
  },
});

export const publish = internalMutation({
  args: {
    version: v.number(),
    seq: v.number(),
    partIds: v.array(v.id("_storage")),
    bytes: v.number(),
    tracks: v.number(),
    cdn: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<boolean> => {
    const meta = await metaRow(ctx);
    // another build got there first (two ran at once) — keep theirs
    if (meta && meta.version >= a.version) return false;

    // keep the previous parts one version longer, for a client mid-download
    const stale: Id<"_storage">[] = [...(meta?.prevPartIds ?? [])];
    const dirtySince = meta ? meta.dirtySeq > a.seq : false;
    const row = {
      key: KEY,
      version: a.version,
      dirtySeq: meta?.dirtySeq ?? a.seq,
      builtSeq: a.seq,
      scheduled: dirtySince,
      partIds: a.partIds,
      prevPartIds: meta?.partIds ?? [],
      bytes: a.bytes,
      tracks: a.tracks,
      builtAt: Date.now(),
      ...(a.cdn ? { cdn: a.cdn } : {}),
    };
    // replace, not patch: the row carries nothing else worth keeping
    if (meta) await ctx.db.replace(meta._id, row);
    else await ctx.db.insert("catalogMeta", row);
    for (const id of stale) await ctx.storage.delete(id);
    // something changed while this build was reading — build again, at the
    // background cadence (an urgent change will bring it forward itself)
    if (dirtySince) {
      const runtime = await runtimeFor(ctx);
      const delay = rebuildDelayMs({ now: Date.now(), builtAt: Date.now(), minIntervalMs: runtime.catalogRebuildHours * 3_600_000 });
      await ctx.db.patch((await metaRow(ctx))!._id, { scheduledFor: Date.now() + delay });
      await ctx.scheduler.runAfter(delay, internal.catalog.rebuild, {});
    }
    return true;
  },
});

/**
 * Rebuild in REBUILD_DELAY_MS instead of at the background cadence — for an
 * operator who changed something outside the catalogue that should show now
 * (the R2 copy coming online, say):
 *   npx convex run --prod catalog:refresh
 */
export const refresh = internalMutation({
  args: {},
  handler: async (ctx) => {
    await touchCatalog(ctx, { urgent: true });
  },
});

/** Operator/debug view: what's published and how big it is. */
export const info = internalQuery({
  args: {},
  handler: async (ctx) => {
    const meta = await metaRow(ctx);
    if (!meta) return null;
    return {
      version: meta.version,
      parts: meta.partIds?.length ?? 0,
      tracks: meta.tracks,
      bytes: meta.bytes,
      builtAt: meta.builtAt,
      dirtySeq: meta.dirtySeq,
      builtSeq: meta.builtSeq,
      scheduled: meta.scheduled,
      cdn: meta.cdn ?? null,
    };
  },
});
