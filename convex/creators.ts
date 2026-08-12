import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  cleanAccent,
  cleanText,
  enforceRateLimit,
  ensureActiveProfile,
  getProfile,
  hasPermission,
  requirePermission,
  requireUser,
} from "./security";

/**
 * The creator side: artists publish their own music and mark the hooks in it.
 *
 * Why uploads matter — an iTunes or Deezer preview is a single fixed ~30s
 * window, so an imported track can only ever have one hook. Full audio from the
 * rights holder is the only source several hooks can be cut from, which is why
 * multi-hook and "own your catalogue" turn out to be the same feature.
 */

const MAX = { artistName: 60, bio: 400, label: 40, link: 200, title: 120, album: 120, genre: 40 } as const;
const MAX_LINKS = 4;
const MAX_HOOKS_PER_TRACK = 6;
const MIN_HOOK_MS = 5_000;
const MAX_HOOK_MS = 45_000;

async function getCreator(ctx: QueryCtx | MutationCtx, userId: string) {
  return ctx.db
    .query("creators")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** Approved creator, or anyone holding catalog.curate. Throws otherwise. */
async function requireCreator(ctx: MutationCtx) {
  const user = await requireUser(ctx);
  const profile = await getProfile(ctx, user.id);
  ensureActiveProfile(profile);
  if (hasPermission(profile, "catalog.curate")) return { user, profile, curator: true };
  const creator = await getCreator(ctx, user.id);
  if (creator?.status !== "approved") {
    throw new Error("Your creator account isn't approved yet");
  }
  return { user, profile, curator: false };
}

/** A track you own, or any track if you curate the catalogue. */
async function requireOwnedTrack(ctx: MutationCtx, trackId: string, curator: boolean, userId: string) {
  const track = await ctx.db
    .query("tracks")
    .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
    .unique();
  if (!track) throw new Error("No such track");
  if (!curator && track.ownerUserId !== userId) throw new Error("Not your track");
  return track;
}

// ---------------------------------------------------------------- applying

export const apply = mutation({
  args: {
    artistName: v.string(),
    bio: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `creator:apply:${user.id}`, 5, 60 * 60_000);

    const artistName = cleanText(args.artistName, MAX.artistName);
    if (artistName.length < 2) throw new Error("What name do you release under?");

    const existing = await getCreator(ctx, user.id);
    // a re-application never resets a decision
    if (existing) return { status: existing.status, duplicate: true };

    await ctx.db.insert("creators", {
      userId: user.id,
      email: profile?.email ?? user.email ?? "",
      artistName,
      bio: args.bio ? cleanText(args.bio, MAX.bio) : undefined,
      links: (args.links ?? [])
        .map((l) => cleanText(l, MAX.link))
        .filter((l) => /^https?:\/\//i.test(l))
        .slice(0, MAX_LINKS),
      status: "pending",
      appliedAt: new Date().toISOString(),
    });
    return { status: "pending" as const, duplicate: false };
  },
});

/** Everything the creator dashboard needs in one round trip. */
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    const creator = await getCreator(ctx, user.id);
    const curator = hasPermission(profile, "catalog.curate");

    if (!creator && !curator) return { creator: null, curator: false, tracks: [] };

    const owned = curator
      ? await ctx.db.query("tracks").collect()
      : await ctx.db
          .query("tracks")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", user.id))
          .collect();

    const tracks = await Promise.all(
      owned.map(async (track) => {
        const hooks = await ctx.db
          .query("hooks")
          .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
          .collect();
        hooks.sort((a, b) => a.order - b.order);
        return {
          ...track,
          audioUrl: track.audioStorageId ? await ctx.storage.getUrl(track.audioStorageId) : null,
          hooks,
        };
      }),
    );
    tracks.sort((a, b) => a.title.localeCompare(b.title));

    return { creator, curator, tracks };
  },
});

// ---------------------------------------------------------------- audio

/** Convex-hosted upload, so the file never passes through our own server. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireCreator(ctx);
    await enforceRateLimit(ctx, `creator:upload:${user.id}`, 30, 60 * 60_000);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachAudio = mutation({
  args: {
    trackId: v.string(),
    storageId: v.id("_storage"),
    audioDurationMs: v.number(),
  },
  handler: async (ctx, { trackId, storageId, audioDurationMs }) => {
    const { user, curator } = await requireCreator(ctx);
    const track = await requireOwnedTrack(ctx, trackId, curator, user.id);
    if (audioDurationMs < 1000 || audioDurationMs > 20 * 60_000) {
      throw new Error("That doesn't look like a track length");
    }
    // replacing audio drops the old file rather than leaking it
    if (track.audioStorageId && track.audioStorageId !== storageId) {
      await ctx.storage.delete(track.audioStorageId);
    }
    await ctx.db.patch(track._id, { audioStorageId: storageId, audioDurationMs });
  },
});

// ---------------------------------------------------------------- tracks

export const createTrack = mutation({
  args: {
    title: v.string(),
    artist: v.string(),
    album: v.optional(v.string()),
    genre: v.string(),
    artwork: v.string(),
    previewUrl: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    accent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, curator } = await requireCreator(ctx);
    await enforceRateLimit(ctx, `creator:track:${user.id}`, 60, 60 * 60_000);

    const title = cleanText(args.title, MAX.title);
    const artist = cleanText(args.artist, MAX.artistName);
    if (!title || !artist) throw new Error("A title and an artist, at minimum");

    const https = (url: string) => (/^https:\/\//i.test(url) ? cleanText(url, 500) : "");
    const trackId = `own:${user.id}:${Date.now().toString(36)}`;

    await ctx.db.insert("tracks", {
      trackId,
      title,
      artist,
      album: cleanText(args.album ?? "", MAX.album),
      artwork: https(args.artwork),
      previewUrl: https(args.previewUrl ?? ""),
      durationMs: Math.max(0, Math.min(args.durationMs ?? 0, 20 * 60_000)),
      genre: cleanText(args.genre, MAX.genre),
      accent: cleanAccent(args.accent ?? "#ff3d71"),
      ownerUserId: curator ? undefined : user.id,
      origin: "artist",
      hidden: true, // nothing reaches the deck until a hook exists and it's published
    });
    return { trackId };
  },
});

export const setTrackHidden = mutation({
  args: { trackId: v.string(), hidden: v.boolean() },
  handler: async (ctx, { trackId, hidden }) => {
    const { user, curator } = await requireCreator(ctx);
    const track = await requireOwnedTrack(ctx, trackId, curator, user.id);
    if (!hidden) {
      const hooks = await ctx.db
        .query("hooks")
        .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
        .collect();
      if (!hooks.some((h) => h.active)) {
        throw new Error("Mark at least one hook before publishing this");
      }
      if (!track.previewUrl && !track.audioStorageId) {
        throw new Error("There's no audio on this track yet");
      }
    }
    await ctx.db.patch(track._id, { hidden });
  },
});

// ---------------------------------------------------------------- hooks

export const upsertHook = mutation({
  args: {
    hookId: v.optional(v.id("hooks")),
    trackId: v.string(),
    startMs: v.number(),
    durationMs: v.number(),
    label: v.optional(v.string()),
    order: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, curator } = await requireCreator(ctx);
    const track = await requireOwnedTrack(ctx, args.trackId, curator, user.id);

    const startMs = Math.max(0, Math.round(args.startMs));
    const durationMs = Math.round(args.durationMs);
    if (durationMs < MIN_HOOK_MS || durationMs > MAX_HOOK_MS) {
      throw new Error("A hook runs between 5 and 45 seconds");
    }

    // A preview is one fixed window — you can only cut inside what you have.
    const ceiling = track.audioDurationMs ?? track.durationMs ?? 30_000;
    if (ceiling > 0 && startMs + durationMs > ceiling + 1_000) {
      throw new Error("That hook runs past the end of the audio");
    }

    const existing = await ctx.db
      .query("hooks")
      .withIndex("by_trackId", (q) => q.eq("trackId", track.trackId))
      .collect();

    if (args.hookId) {
      const hook = await ctx.db.get(args.hookId);
      if (!hook || hook.trackId !== track.trackId) throw new Error("No such hook");
      await ctx.db.patch(args.hookId, {
        startMs,
        durationMs,
        label: args.label ? cleanText(args.label, MAX.label) : undefined,
        order: args.order ?? hook.order,
        active: args.active ?? hook.active,
      });
      return { hookId: args.hookId };
    }

    if (existing.length >= MAX_HOOKS_PER_TRACK) {
      throw new Error(`${MAX_HOOKS_PER_TRACK} hooks is plenty for one song`);
    }
    if (!track.audioStorageId && existing.length >= 1) {
      throw new Error(
        "This track only has a 30-second preview, which is a single window — upload the full audio to mark more than one hook",
      );
    }

    const hookId = await ctx.db.insert("hooks", {
      trackId: track.trackId,
      startMs,
      durationMs,
      label: args.label ? cleanText(args.label, MAX.label) : undefined,
      order: args.order ?? existing.length,
      active: args.active ?? true,
      createdBy: user.id,
      source: curator ? "curated" : "artist",
      plays: 0,
      saves: 0,
      skips: 0,
    });
    return { hookId };
  },
});

export const deleteHook = mutation({
  args: { hookId: v.id("hooks") },
  handler: async (ctx, { hookId }) => {
    const { user, curator } = await requireCreator(ctx);
    const hook = await ctx.db.get(hookId);
    if (!hook) return;
    await requireOwnedTrack(ctx, hook.trackId, curator, user.id);
    await ctx.db.delete(hookId);
  },
});

// ---------------------------------------------------------------- admin

export const listCreators = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "users.view");
    const rows = await ctx.db.query("creators").collect();
    rows.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      creators: rows,
    };
  },
});

export const decideCreator = mutation({
  args: {
    id: v.id("creators"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
  },
  handler: async (ctx, { id, status }) => {
    await requirePermission(ctx, "users.manage");
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    await ctx.db.patch(id, {
      status,
      decidedAt: new Date().toISOString(),
      decidedBy: profile?.email ?? user.id,
    });
  },
});
