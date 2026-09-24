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
 * Tracks whose energy was measured on an older scale, or never measured.
 *
 * Only already-analysed tracks: a track still waiting for hooks gets its
 * energy from that first pass anyway.
 */
export const staleEnergyTracks = internalQuery({
  args: { limit: v.number(), cal: v.number() },
  handler: async (ctx, { limit, cal }) => {
    const all = await ctx.db.query("tracks").collect();
    return all
      .filter(
        (t) =>
          t.hidden !== true &&
          t.analyzedAt !== undefined &&
          !!t.previewUrl &&
          t.energyCal !== cal,
      )
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map((t) => ({
        trackId: t.trackId,
        title: t.title,
        artist: t.artist,
        previewUrl: t.previewUrl,
        audioUrl: null as string | null,
        durationMs: t.durationMs,
      }));
  },
});

/** Replace a track's energy alone — its hooks, and their stats, stay put. */
export const ingestEnergy = internalMutation({
  args: { trackId: v.string(), energy: v.union(v.number(), v.null()), cal: v.number() },
  handler: async (ctx, { trackId, energy, cal }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
      .unique();
    if (!track) return { ok: false as const, reason: "no track" };
    const safe =
      typeof energy === "number" && Number.isFinite(energy) ? Math.min(Math.max(energy, 0), 1) : undefined;
    // stamped even when the audio wouldn't decode, so a dead preview isn't
    // downloaded again on every run
    await ctx.db.patch(track._id, { energy: safe, energyCal: cal });
    return { ok: true as const, written: 0, energy: safe ?? null };
  },
});

/** Tracks the sound analyser hasn't heard, or heard with an older model. */
export const soundPendingTracks = internalQuery({
  args: { limit: v.number(), version: v.number() },
  handler: async (ctx, { limit, version }) => {
    const all = await ctx.db.query("tracks").collect();
    return all
      .filter((t) => t.hidden !== true && !!t.previewUrl && t.soundVersion !== version)
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map((t) => ({ trackId: t.trackId, title: t.title, artist: t.artist, previewUrl: t.previewUrl }));
  },
});

const SOUND_B64 = /^[A-Za-z0-9+/]{42,44}={0,2}$/;

/**
 * Store what the sound analyser heard. Validated hard: this lands in every
 * client's ranking, so a malformed vector must be dropped, not stored.
 * A preview that wouldn't decode is stamped with the version and nothing
 * else, so it isn't downloaded again on every run.
 */
export const ingestSound = internalMutation({
  args: {
    trackId: v.string(),
    version: v.number(),
    sound: v.optional(v.string()),
    audioMood: v.optional(v.array(v.number())),
    vocal: v.optional(v.number()),
  },
  handler: async (ctx, { trackId, version, sound, audioMood, vocal }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
      .unique();
    if (!track) return { ok: false as const, reason: "no track" };
    const goodSound = typeof sound === "string" && SOUND_B64.test(sound) ? sound : undefined;
    const goodMood =
      Array.isArray(audioMood) &&
      audioMood.length === 6 &&
      audioMood.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)
        ? audioMood.map((x) => Math.round(x * 1000) / 1000)
        : undefined;
    const goodVocal =
      typeof vocal === "number" && Number.isFinite(vocal) ? Math.min(Math.max(vocal, 0), 1) : undefined;
    await ctx.db.patch(track._id, {
      sound: goodSound,
      audioMood: goodMood,
      vocal: goodVocal,
      soundVersion: Math.floor(version),
    });
    return { ok: true as const, heard: goodSound !== undefined };
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
    /** measured arousal 0..1; absent when the preview couldn't be decoded */
    energy: v.optional(v.union(v.number(), v.null())),
    /** the energy scale's calibration version, from the analyser */
    energyCal: v.optional(v.number()),
  },
  handler: async (ctx, { trackId, analyzedAt, windows, energy, energyCal }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
      .unique();
    if (!track) return { ok: false as const, reason: "no track" };

    // bounded ISO timestamp — the analyzer is trusted but not infallible
    const stamp = cleanText(analyzedAt, 40) || new Date().toISOString();

    // Written before the window checks below, deliberately: if the audio
    // decoded then the measurement is real, and mood inference wants it whether
    // or not any window survived the filters. Losing it to an unrelated early
    // return would mean re-downloading the whole preview to get it back.
    const safeEnergy =
      typeof energy === "number" && Number.isFinite(energy)
        ? Math.min(Math.max(energy, 0), 1)
        : undefined;
    if (safeEnergy !== undefined) await ctx.db.patch(track._id, { energy: safeEnergy, energyCal });

    const safeWindows = windows
      .slice(0, MAX_WINDOWS)
      .map((w) => ({
        startMs: Math.max(0, Math.floor(w.startMs)),
        durationMs: Math.min(Math.max(Math.floor(w.durationMs), 5_000), 45_000),
      }))
      .filter((w) => w.startMs + w.durationMs <= (track.audioDurationMs ?? track.durationMs ?? 60_000) + 2_000);
    if (safeWindows.length === 0) {
      // marked as looked-at: the analyser posts an empty list for a preview
      // that wouldn't decode precisely so it isn't downloaded again every run,
      // and without this stamp it was
      await ctx.db.patch(track._id, { analyzedAt: stamp });
      return { ok: false as const, reason: "no usable windows" };
    }

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

    await ctx.db.patch(track._id, { analyzedAt: stamp });
    return {
      ok: true as const,
      written: safeWindows.length,
      energy: safeEnergy ?? null,
    };
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
