import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { saveTarget, swipeAction, trackFields } from "./schema";
import {
  cleanAccent,
  cleanText,
  cleanTrack,
  enforceRateLimit,
  ensureActiveProfile,
  getProfile,
  requireGatedUser,
  requireUser,
  type TrackInput,
  validateSaveTarget,
} from "./security";

/**
 * Called after sign-in. Creates the profile — and this is the real access gate.
 *
 * Signing in isn't enough: unless the email has an approved access request, no
 * profile is created and every downstream query returns nothing. The check lives
 * here rather than in the UI so it can't be clicked past. Accounts that already
 * have a profile return early and are never re-checked, so turning this on can't
 * lock out anyone who is already in.
 */
export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await enforceRateLimit(ctx, `profile:${user.id}`, 20, 60_000);
    const existing = await getProfile(ctx, user.id);

    const email = (user.email ?? "").toLowerCase();
    // Admins come from an explicit allowlist. The old rule was "first account
    // ever becomes admin", which on an empty production database handed the
    // dashboard to whichever stranger signed up first.
    // Set with: npx convex env set ADMIN_EMAILS "you@example.com,other@example.com"
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = email.length > 0 && admins.includes(email);

    // adding an email to the allowlist promotes an EXISTING profile too —
    // only ever upward, so this can't be used to demote or lock anyone out
    if (existing) {
      if (isAdmin && !existing.isAdmin) {
        await ctx.db.patch(existing._id, { isAdmin: true });
        return { ...existing, isAdmin: true };
      }
      return existing;
    }

    if (!isAdmin) {
      const request = email
        ? await ctx.db
            .query("accessRequests")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique()
        : null;
      if (request?.status !== "approved") {
        // the client turns these into the pending / rejected / apply screens
        throw new Error(
          request?.status === "rejected"
            ? "ACCESS_REJECTED"
            : request
              ? "ACCESS_PENDING"
              : "ACCESS_NOT_REQUESTED",
        );
      }
    }

    const id = await ctx.db.insert("profiles", {
      userId: user.id,
      email: user.email ?? "",
      name: user.name ?? undefined,
      isAdmin,
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
    const buried = await ctx.db
      .query("neverTracks")
      .withIndex("by_user_track", (q) => q.eq("userId", userId))
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
        allowRepeats: p.allowRepeats ?? false,
        includeBuried: p.includeBuried ?? false,
        includeBlockedArtists: p.includeBlockedArtists ?? false,
        songs: songs.filter((s) => s.playlistId === p._id),
      })),
      neverArtists: never.map((n) => n.artist),
      neverTracks: buried.map((n) => n.trackId),
      replayContainers: profile?.replayContainers ?? [],
      taste: profile?.taste ?? null,
      prefs: profile?.prefs ?? null,
      saveTarget: profile?.saveTarget ?? "liked",
      isAdmin: profile?.isAdmin ?? false,
      permissions: profile?.permissions ?? [],
      email: profile?.email ?? user.email ?? "",
    };
  },
});

export const createPlaylist = mutation({
  args: {
    name: v.string(),
    accent: v.string(),
    allowRepeats: v.optional(v.boolean()),
    includeBuried: v.optional(v.boolean()),
    includeBlockedArtists: v.optional(v.boolean()),
  },
  handler: async (ctx, { name, accent, allowRepeats, includeBuried, includeBlockedArtists }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `playlist:create:${user.id}`, 20, 10 * 60_000);
    const trimmed = cleanText(name, 40);
    if (!trimmed) throw new Error("Playlist needs a name");
    const id = await ctx.db.insert("playlists", {
      userId: user.id,
      name: trimmed,
      accent: cleanAccent(accent),
      allowRepeats: allowRepeats === true,
      includeBuried: includeBuried === true,
      includeBlockedArtists: includeBlockedArtists === true,
    });
    return id;
  },
});

/**
 * Flip a playlist's discovery rules. Ownership is re-verified — rules are per
 * playlist, not per request.
 */
export const updatePlaylistRules = mutation({
  args: {
    playlistId: v.id("playlists"),
    allowRepeats: v.optional(v.boolean()),
    includeBuried: v.optional(v.boolean()),
    includeBlockedArtists: v.optional(v.boolean()),
  },
  handler: async (ctx, { playlistId, ...rules }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `playlist:rules:${user.id}`, 60, 60_000);
    const playlist = await ctx.db.get(playlistId);
    if (!playlist || playlist.userId !== user.id) throw new Error("Not your playlist");
    const patch: Record<string, boolean> = {};
    for (const key of ["allowRepeats", "includeBuried", "includeBlockedArtists"] as const) {
      if (rules[key] !== undefined) patch[key] = rules[key] === true;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(playlistId, patch);
  },
});

export const deletePlaylist = mutation({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `playlist:delete:${user.id}`, 30, 10 * 60_000);
    const playlist = await ctx.db.get(playlistId);
    if (!playlist || playlist.userId !== user.id) throw new Error("Not your playlist");
    const songs = await ctx.db
      .query("librarySongs")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .collect();
    for (const s of songs) await ctx.db.delete(s._id);
    await ctx.db.delete(playlistId);
    if (profile?.saveTarget === `pl:${playlistId}`) {
      await ctx.db.patch(profile._id, { saveTarget: "liked" });
    }
  },
});

export const removeSong = mutation({
  args: { trackId: v.string() },
  handler: async (ctx, { trackId }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `library:remove:${user.id}`, 120, 60_000);
    const safeTrackId = cleanText(trackId, 120);
    const songs = await ctx.db
      .query("librarySongs")
      .withIndex("by_user_track", (q) =>
        q.eq("userId", user.id).eq("trackId", safeTrackId),
      )
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
    const playlistId = ctx.db.normalizeId("playlists", target.slice(3));
    if (!playlistId) return;
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
    /** which hook was playing — the whole point of the per-hook counters */
    hookId: v.optional(v.id("hooks")),
  },
  handler: async (ctx, { track, action, hookId }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `swipe:${user.id}`, 180, 60_000);
    const safeTrack = cleanTrack(track);
    await ctx.db.insert("swipes", {
      userId: user.id,
      action,
      trackId: safeTrack.trackId,
      title: safeTrack.title,
      artist: safeTrack.artist,
      genre: safeTrack.genre,
      artwork: safeTrack.artwork,
    });
    if (action === "save") {
      await saveToTarget(ctx, user.id, profile?.saveTarget ?? "liked", safeTrack);
    }

    // credit the hook that was actually on screen. A "more" counts as interest
    // without a save; "never" is about the artist, not the hook, so it only
    // counts as a play.
    if (hookId) {
      const hook = await ctx.db.get(hookId);
      if (hook && hook.trackId === safeTrack.trackId) {
        // hookStats, not the hook itself — the hook row is read by every
        // client's catalogue query, and writing to it here would invalidate
        // that query on every swipe anyone makes
        const stats = await ctx.db
          .query("hookStats")
          .withIndex("by_hookId", (q) => q.eq("hookId", hookId))
          .unique();
        const saved = action === "save" || action === "more" ? 1 : 0;
        const skipped = action === "skip" ? 1 : 0;
        if (stats) {
          await ctx.db.patch(stats._id, {
            plays: stats.plays + 1,
            saves: stats.saves + saved,
            skips: stats.skips + skipped,
          });
        } else {
          await ctx.db.insert("hookStats", {
            hookId,
            trackId: hook.trackId,
            plays: 1,
            saves: saved,
            skips: skipped,
          });
        }
      }
    }
    if (action === "never") {
      // the song itself, permanently — the artist block below is a separate,
      // broader promise and a listener may lift it later
      const buriedAlready = await ctx.db
        .query("neverTracks")
        .withIndex("by_user_track", (q) =>
          q.eq("userId", user.id).eq("trackId", safeTrack.trackId),
        )
        .unique();
      if (!buriedAlready) {
        await ctx.db.insert("neverTracks", {
          userId: user.id,
          trackId: safeTrack.trackId,
        });
      }

      const existing = await ctx.db
        .query("neverArtists")
        .withIndex("by_user_artist", (q) =>
          q.eq("userId", user.id).eq("artist", safeTrack.artist),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("neverArtists", {
          userId: user.id,
          artist: safeTrack.artist,
        });
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
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `swipe:revert:${user.id}`, 120, 60_000);
    const safeTrackId = cleanText(trackId, 120);
    const safeArtist = cleanText(artist, 160);
    const swipes = await ctx.db
      .query("swipes")
      .withIndex("by_user_track", (q) =>
        q.eq("userId", user.id).eq("trackId", safeTrackId),
      )
      .collect();
    const latest = swipes.filter((s) => s.action === action).pop();
    if (latest) await ctx.db.delete(latest._id);
    if (action === "save") {
      const songs = await ctx.db
        .query("librarySongs")
        .withIndex("by_user_track", (q) =>
          q.eq("userId", user.id).eq("trackId", safeTrackId),
        )
        .collect();
      for (const s of songs) await ctx.db.delete(s._id);
    }
    if (action === "never") {
      // undoing a left swipe must lift BOTH promises it made: the song is
      // un-buried and the artist block goes too. The artist row is only
      // removed when no other left-swipe of theirs still vouches for it —
      // two "nevers" used to be undone by one ↩, silently resurrecting an
      // artist the listener had buried twice.
      const buried = await ctx.db
        .query("neverTracks")
        .withIndex("by_user_track", (q) =>
          q.eq("userId", user.id).eq("trackId", safeTrackId),
        )
        .unique();
      if (buried) await ctx.db.delete(buried._id);

      const stillBlocked = swipes.some(
        (s) => s.action === "never" && s.artist === safeArtist && s._id !== latest?._id,
      );
      if (!stillBlocked) {
        const entry = await ctx.db
          .query("neverArtists")
          .withIndex("by_user_artist", (q) =>
            q.eq("userId", user.id).eq("artist", safeArtist),
          )
          .unique();
        if (entry) await ctx.db.delete(entry._id);
      }
    }
  },
});

/**
 * Let a container's songs back into the deck, or take them out again.
 *
 * `container` is "liked", "discoveries" or "pl:<playlistId>". The default for
 * everything is out — saving a song is normally a reason to stop showing it.
 */
export const setReplayContainer = mutation({
  args: { container: v.string(), allow: v.boolean() },
  handler: async (ctx, { container, allow }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    if (!profile) throw new Error("No profile");
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `replay:${user.id}`, 120, 60_000);

    // validate rather than trusting the string: a playlist id has to be one of
    // this user's, so a stray value can't quietly disable their filtering
    const target = await validateSaveTarget(ctx, user.id, cleanText(container, 80));

    const current = new Set(profile.replayContainers ?? []);
    if (allow) current.add(target);
    else current.delete(target);
    await ctx.db.patch(profile._id, { replayContainers: [...current] });
    return [...current];
  },
});

/** Lift a song out of the buried list, so it can come round again. */
export const unburyTrack = mutation({
  args: { trackId: v.string() },
  handler: async (ctx, { trackId }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `unbury:${user.id}`, 120, 60_000);
    const row = await ctx.db
      .query("neverTracks")
      .withIndex("by_user_track", (q) =>
        q.eq("userId", user.id).eq("trackId", cleanText(trackId, 120)),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/** Lift an artist block ("unblock"), so their songs can come round again. */
export const unblockArtist = mutation({
  args: { artist: v.string() },
  handler: async (ctx, { artist }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `unblock:${user.id}`, 120, 60_000);
    const row = await ctx.db
      .query("neverArtists")
      .withIndex("by_user_artist", (q) =>
        q.eq("userId", user.id).eq("artist", cleanText(artist, 160)),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/** Store what the onboarding questions collected. */
export const setTaste = mutation({
  args: {
    languages: v.array(v.string()),
    genres: v.array(v.string()),
    adventure: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    if (!profile) throw new Error("No profile");
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `taste:${user.id}`, 30, 60_000);
    await ctx.db.patch(profile._id, {
      taste: {
        // bounded: these are ids from a fixed list, not free text
        languages: args.languages.slice(0, 12).map((x) => cleanText(x, 8)),
        genres: args.genres.slice(0, 16).map((x) => cleanText(x, 16)),
        adventure: cleanText(args.adventure, 8),
      },
    });
  },
});

export const setSaveTarget = mutation({
  args: { target: saveTarget },
  handler: async (ctx, { target }) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `profile:save-target:${user.id}`, 120, 60_000);
    const safeTarget = await validateSaveTarget(ctx, user.id, target);
    if (profile) await ctx.db.patch(profile._id, { saveTarget: safeTarget });
  },
});

/**
 * Store the Settings choices that should follow a listener across devices
 * (motion level, accent, haptics, swipe sensitivity, ads opt-out). Volume is
 * deliberately absent — hardware differs per device, so it stays local.
 *
 * Values are coerced through the same rules the clients use; an old or
 * hand-edited row can't smuggle in garbage.
 */
export const setPrefs = mutation({
  args: {
    motion: v.string(),
    haptics: v.string(),
    accentMode: v.string(),
    accentColor: v.string(),
    swipeSensitivity: v.number(),
    adsOptOut: v.boolean(),
    adFrequency: v.string(),
    adEveryNSwipes: v.optional(v.number()),
    allowRepeats: v.boolean(),
    includeBuried: v.boolean(),
    includeBlockedArtists: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    if (!profile) throw new Error("No profile");
    ensureActiveProfile(profile);
    await enforceRateLimit(ctx, `prefs:${user.id}`, 60, 60_000);

    const motion = ["full", "reduced", "off"].includes(args.motion)
      ? args.motion
      : "full";
    const haptics = ["off", "subtle", "full"].includes(args.haptics)
      ? args.haptics
      : "subtle";
    const accentMode = args.accentMode === "custom" ? "custom" : "track";
    const accentColor = cleanAccent(args.accentColor).toUpperCase();
    const sensitivity = Math.round(
      Math.min(Math.max(args.swipeSensitivity, 0.6), 1.4) * 100,
    ) / 100;
    const adsOptOut = args.adsOptOut === true;
    const adFrequency = ["often", "normal", "rarely"].includes(args.adFrequency)
      ? args.adFrequency
      : "normal";
    // the listener's own gap: clamped to the same 3–200 band the deck enforces
    const adEveryNSwipes =
      typeof args.adEveryNSwipes === "number" &&
      Number.isFinite(args.adEveryNSwipes)
        ? Math.min(Math.max(Math.round(args.adEveryNSwipes), 3), 200)
        : undefined;

    await ctx.db.patch(profile._id, {
      prefs: {
        motion,
        haptics,
        accentMode,
        accentColor,
        swipeSensitivity: sensitivity,
        adsOptOut,
        adFrequency,
        ...(adEveryNSwipes !== undefined ? { adEveryNSwipes } : {}),
        allowRepeats: args.allowRepeats === true,
        includeBuried: args.includeBuried === true,
        includeBlockedArtists: args.includeBlockedArtists === true,
      },
    });
  },
});

/**
 * Self-service account deletion.
 *
 * Google Play requires an in-app path to delete an account and its data, plus a
 * publicly reachable URL describing it — hookedcue.com/data-deletion. This is
 * that path. It removes everything keyed to the user and the access request, so
 * the email is genuinely free to apply again afterwards.
 *
 * The Better Auth credential row is cleared by signing out and is orphaned
 * without a profile; ensureProfile will refuse to recreate one unless the email
 * is approved again.
 */
export const deleteMyAccount = mutation({
  args: { confirm: v.literal("DELETE") },
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await enforceRateLimit(ctx, `delete-account:${user.id}`, 3, 60 * 60_000);
    const profile = await getProfile(ctx, user.id);
    if (!profile) throw new Error("No account to delete");
    if (profile.isAdmin) {
      throw new Error("Admins can't delete themselves — hand the role over first");
    }

    const userId = profile.userId;
    const [swipes, songs, never, buried, playlists] = await Promise.all([
      ctx.db.query("swipes").withIndex("by_userId", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("librarySongs").withIndex("by_user_kind", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("neverArtists").withIndex("by_user_artist", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("neverTracks").withIndex("by_user_track", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("playlists").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    ]);
    for (const doc of [...swipes, ...songs, ...never, ...buried, ...playlists]) {
      await ctx.db.delete(doc._id);
    }

    // drop the access request too, so the address isn't left sitting in the
    // queue after the person has asked to be forgotten
    const email = (profile.email ?? "").toLowerCase();
    if (email) {
      const request = await ctx.db
        .query("accessRequests")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (request) await ctx.db.delete(request._id);
    }

    await ctx.db.delete(profile._id);
    return { deleted: true };
  },
});
