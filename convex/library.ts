import { v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { saveTarget, swipeAction, trackFields } from "./schema";

const trackValidator = v.object(trackFields);
type TrackInput = Infer<typeof trackValidator>;

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not signed in");
  return { id: String(user._id), email: user.email, name: user.name };
}

async function getProfile(ctx: QueryCtx | MutationCtx, userId: string) {
  return ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** Called after sign-in. Creates the profile; the first user ever becomes admin. */
export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const existing = await getProfile(ctx, user.id);
    if (existing) return existing;
    const anyProfile = await ctx.db.query("profiles").first();
    const id = await ctx.db.insert("profiles", {
      userId: user.id,
      email: user.email ?? "",
      name: user.name ?? undefined,
      isAdmin: anyProfile === null, // first account becomes the admin
      permissions: [],
      saveTarget: "liked",
    });
    return await ctx.db.get(id);
  },
});

export const getLibrary = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const userId = String(user._id);
    const profile = await getProfile(ctx, userId);
    const songs = await ctx.db
      .query("librarySongs")
      .withIndex("by_user_kind", (q) => q.eq("userId", userId))
      .collect();
    const never = await ctx.db
      .query("neverArtists")
      .withIndex("by_user_artist", (q) => q.eq("userId", userId))
      .collect();
    const playlists = await ctx.db
      .query("playlists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return {
      liked: songs.filter((s) => s.kind === "liked"),
      discoveries: songs.filter((s) => s.kind === "discoveries"),
      playlists: playlists.map((p) => ({
        id: p._id,
        name: p.name,
        accent: p.accent,
        songs: songs.filter((s) => s.playlistId === p._id),
      })),
      neverArtists: never.map((n) => n.artist),
      saveTarget: profile?.saveTarget ?? "liked",
      isAdmin: profile?.isAdmin ?? false,
      permissions: profile?.permissions ?? [],
      email: profile?.email ?? user.email ?? "",
    };
  },
});

export const createPlaylist = mutation({
  args: { name: v.string(), accent: v.string() },
  handler: async (ctx, { name, accent }) => {
    const user = await requireUser(ctx);
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) throw new Error("Playlist needs a name");
    const id = await ctx.db.insert("playlists", {
      userId: user.id,
      name: trimmed,
      accent,
    });
    return id;
  },
});

export const deletePlaylist = mutation({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    const user = await requireUser(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (!playlist || playlist.userId !== user.id) throw new Error("Not your playlist");
    const songs = await ctx.db
      .query("librarySongs")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .collect();
    for (const s of songs) await ctx.db.delete(s._id);
    await ctx.db.delete(playlistId);
    const profile = await getProfile(ctx, user.id);
    if (profile?.saveTarget === `pl:${playlistId}`) {
      await ctx.db.patch(profile._id, { saveTarget: "liked" });
    }
  },
});

export const removeSong = mutation({
  args: { trackId: v.string() },
  handler: async (ctx, { trackId }) => {
    const user = await requireUser(ctx);
    const songs = await ctx.db
      .query("librarySongs")
      .withIndex("by_user_track", (q) => q.eq("userId", user.id).eq("trackId", trackId))
      .collect();
    for (const s of songs) await ctx.db.delete(s._id);
  },
});

async function saveToTarget(
  ctx: MutationCtx,
  userId: string,
  target: string,
  track: TrackInput,
) {
  const existing = await ctx.db
    .query("librarySongs")
    .withIndex("by_user_track", (q) => q.eq("userId", userId).eq("trackId", track.trackId))
    .first();
  if (existing) return;
  if (target.startsWith("pl:")) {
    const playlistId = target.slice(3) as Id<"playlists">;
    const playlist = await ctx.db.get(playlistId);
    if (!playlist || playlist.userId !== userId) return;
    await ctx.db.insert("librarySongs", {
      userId,
      kind: "playlist",
      playlistId,
      ...track,
    });
  } else {
    await ctx.db.insert("librarySongs", {
      userId,
      kind: target === "discoveries" ? "discoveries" : "liked",
      ...track,
    });
  }
}

export const recordSwipe = mutation({
  args: {
    track: v.object(trackFields),
    action: swipeAction,
  },
  handler: async (ctx, { track, action }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    if (profile?.suspended) throw new Error("Account suspended");
    await ctx.db.insert("swipes", {
      userId: user.id,
      action,
      trackId: track.trackId,
      title: track.title,
      artist: track.artist,
      genre: track.genre,
      artwork: track.artwork,
    });
    if (action === "save") {
      await saveToTarget(ctx, user.id, profile?.saveTarget ?? "liked", track);
    }
    if (action === "never") {
      const existing = await ctx.db
        .query("neverArtists")
        .withIndex("by_user_artist", (q) =>
          q.eq("userId", user.id).eq("artist", track.artist),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("neverArtists", { userId: user.id, artist: track.artist });
      }
    }
  },
});

/** Mirrors the ↩ back button: removes the latest swipe and reverts its side effects. */
export const revertSwipe = mutation({
  args: {
    trackId: v.string(),
    artist: v.string(),
    action: swipeAction,
  },
  handler: async (ctx, { trackId, artist, action }) => {
    const user = await requireUser(ctx);
    const swipes = await ctx.db
      .query("swipes")
      .withIndex("by_user_track", (q) => q.eq("userId", user.id).eq("trackId", trackId))
      .collect();
    const latest = swipes.filter((s) => s.action === action).pop();
    if (latest) await ctx.db.delete(latest._id);
    if (action === "save") {
      const songs = await ctx.db
        .query("librarySongs")
        .withIndex("by_user_track", (q) => q.eq("userId", user.id).eq("trackId", trackId))
        .collect();
      for (const s of songs) await ctx.db.delete(s._id);
    }
    if (action === "never") {
      const entry = await ctx.db
        .query("neverArtists")
        .withIndex("by_user_artist", (q) => q.eq("userId", user.id).eq("artist", artist))
        .unique();
      if (entry) await ctx.db.delete(entry._id);
    }
  },
});

export const setSaveTarget = mutation({
  args: { target: saveTarget },
  handler: async (ctx, { target }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    if (profile) await ctx.db.patch(profile._id, { saveTarget: target });
  },
});
