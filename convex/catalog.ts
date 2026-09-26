import { v } from "convex/values";
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
 *
 * See docs/CATALOG.md for the numbers.
 */

const KEY = "catalog";
/** Long enough to fold a burst of writes (an analyser run, a chart pull) into one build. */
export const REBUILD_DELAY_MS = 20_000;

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
export async function touchCatalog(ctx: MutationCtx): Promise<void> {
  const meta = await metaRow(ctx);
  if (!meta) {
    await ctx.db.insert("catalogMeta", {
      key: KEY,
      version: 0,
      dirtySeq: 1,
      builtSeq: 0,
      scheduled: true,
    });
    await ctx.scheduler.runAfter(REBUILD_DELAY_MS, internal.catalog.rebuild, {});
    return;
  }
  await ctx.db.patch(meta._id, { dirtySeq: meta.dirtySeq + 1, scheduled: true });
  if (!meta.scheduled) {
    await ctx.scheduler.runAfter(REBUILD_DELAY_MS, internal.catalog.rebuild, {});
  }
}

/** The tiny thing every client watches. v = 0: no file built yet. */
export const version = query({
  args: {},
  handler: async (ctx): Promise<CatalogVersion> => {
    const meta = await metaRow(ctx);
    const parts = meta?.partIds?.length ?? 0;
    return parts > 0 && meta ? { v: meta.version, parts } : { v: 0, parts: 0 };
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
 * Everything a client needs, read once. Same selection and hook order as
 * tracks.list (kept for app builds that predate this), plus the dirty counter
 * at the moment of reading so the publish step knows what it covered.
 */
export const snapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const meta = await metaRow(ctx);
    const [all, activeHooks] = await Promise.all([
      ctx.db.query("tracks").collect(),
      ctx.db
        .query("hooks")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect(),
    ]);
    const byTrack = hooksByTrack(activeHooks);
    const tracks: CatalogTrack[] = [];
    for (const t of all) {
      if (t.hidden === true) continue;
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
        hooks: (byTrack.get(t.trackId) ?? []).map((h) => ({
          id: h._id,
          startMs: h.startMs,
          durationMs: h.durationMs,
          ...(h.label ? { label: h.label } : {}),
        })),
      });
    }
    return { seq: meta?.dirtySeq ?? 0, version: meta?.version ?? 0, tracks };
  },
});

/** Build the file for the next version. Scheduled by touchCatalog; safe to run by hand. */
export const rebuild = internalAction({
  args: {},
  handler: async (ctx): Promise<{ version: number; parts: number; bytes: number } | null> => {
    const snap = await ctx.runQuery(internal.catalog.snapshot, {});
    const next = snap.version + 1;
    const docs = encodeCatalog(snap.tracks, next);
    const partIds: Id<"_storage">[] = [];
    let bytes = 0;
    for (const doc of docs) {
      const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
      bytes += blob.size;
      partIds.push(await ctx.storage.store(blob));
    }
    const published = await ctx.runMutation(internal.catalog.publish, {
      version: next,
      seq: snap.seq,
      partIds,
      bytes,
      tracks: snap.tracks.length,
    });
    if (!published) {
      for (const id of partIds) await ctx.storage.delete(id);
      return null;
    }
    return { version: next, parts: partIds.length, bytes };
  },
});

export const publish = internalMutation({
  args: {
    version: v.number(),
    seq: v.number(),
    partIds: v.array(v.id("_storage")),
    bytes: v.number(),
    tracks: v.number(),
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
    };
    // replace, not patch: the row carries nothing else worth keeping
    if (meta) await ctx.db.replace(meta._id, row);
    else await ctx.db.insert("catalogMeta", row);
    for (const id of stale) await ctx.storage.delete(id);
    // something changed while this build was reading — build again
    if (dirtySince) await ctx.scheduler.runAfter(REBUILD_DELAY_MS, internal.catalog.rebuild, {});
    return true;
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
    };
  },
});
