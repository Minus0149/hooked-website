import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { PERMISSIONS } from "./schema";

type Perm = (typeof PERMISSIONS)[number];

async function getViewer(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  return ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", String(user._id)))
    .unique();
}

function hasPerm(
  profile: { isAdmin: boolean; permissions?: string[] } | null,
  perm: Perm,
) {
  if (!profile) return false;
  return profile.isAdmin || (profile.permissions ?? []).includes(perm);
}

/** What the current viewer is allowed to see — drives which sections render. */
export const myAccess = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const grants = PERMISSIONS.filter((p) => hasPerm(viewer, p));
    return {
      isAdmin: viewer.isAdmin,
      permissions: grants,
      any: viewer.isAdmin || grants.length > 0,
    };
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "stats.view")) return null;
    const [swipes, profiles] = await Promise.all([
      ctx.db.query("swipes").collect(),
      ctx.db.query("profiles").collect(),
    ]);
    const profileCount = profiles.length;
    const emailByUser = new Map(profiles.map((p) => [p.userId, p.email]));

    const byAction = { skip: 0, save: 0, more: 0, never: 0 };
    for (const s of swipes) byAction[s.action]++;

    const saveCounts = new Map<
      string,
      { count: number; title: string; artist: string; artwork: string }
    >();
    for (const s of swipes) {
      if (s.action !== "save") continue;
      const entry = saveCounts.get(s.trackId) ?? {
        count: 0,
        title: s.title,
        artist: s.artist,
        artwork: s.artwork,
      };
      entry.count++;
      saveCounts.set(s.trackId, entry);
    }
    const topSaved = [...saveCounts.entries()]
      .map(([trackId, e]) => ({ trackId, ...e }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const neverCounts = new Map<string, number>();
    for (const s of swipes) {
      if (s.action !== "never") continue;
      neverCounts.set(s.artist, (neverCounts.get(s.artist) ?? 0) + 1);
    }
    const topNever = [...neverCounts.entries()]
      .map(([artist, count]) => ({ artist, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // live activity buckets (re-render reactively whenever a swipe lands)
    const now = Date.now();
    const MIN_BUCKETS = 30;
    const activity = Array.from({ length: MIN_BUCKETS }, () => 0);
    const HOUR_BUCKETS = 24;
    const activityHours = Array.from({ length: HOUR_BUCKETS }, () => 0);
    const todayByAction = { skip: 0, save: 0, more: 0, never: 0 };
    for (const s of swipes) {
      const age = now - s._creationTime;
      const ageMin = Math.floor(age / 60_000);
      if (ageMin >= 0 && ageMin < MIN_BUCKETS) activity[MIN_BUCKETS - 1 - ageMin]++;
      const ageHour = Math.floor(age / 3_600_000);
      if (ageHour >= 0 && ageHour < HOUR_BUCKETS) {
        activityHours[HOUR_BUCKETS - 1 - ageHour]++;
        todayByAction[s.action]++;
      }
    }

    // genre appetite: how each genre converts swipes into saves
    const genreMap = new Map<string, { total: number; saves: number }>();
    for (const s of swipes) {
      const g = genreMap.get(s.genre) ?? { total: 0, saves: 0 };
      g.total++;
      if (s.action === "save") g.saves++;
      genreMap.set(s.genre, g);
    }
    const genres = [...genreMap.entries()]
      .map(([genre, g]) => ({ genre, ...g }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    return {
      userCount: profileCount,
      swipeCount: swipes.length,
      byAction,
      todayByAction,
      saveRate: swipes.length > 0 ? byAction.save / swipes.length : 0,
      topSaved,
      topNever,
      genres,
      recent: swipes
        .slice(-30)
        .reverse()
        .map((s) => ({ ...s, email: emailByUser.get(s.userId) ?? "unknown" })),
      activity,
      activityHours,
    };
  },
});

export const users = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "users.view")) return null;
    const [profiles, swipes, library] = await Promise.all([
      ctx.db.query("profiles").collect(),
      ctx.db.query("swipes").collect(),
      ctx.db.query("librarySongs").collect(),
    ]);
    return {
      canManage: hasPerm(viewer, "users.manage"),
      viewerIsAdmin: viewer?.isAdmin ?? false,
      allPermissions: [...PERMISSIONS],
      users: profiles.map((p) => {
        const userSwipes = swipes.filter((s) => s.userId === p.userId);
        return {
          profileId: p._id,
          email: p.email,
          isAdmin: p.isAdmin,
          suspended: p.suspended ?? false,
          permissions: p.permissions ?? [],
          joined: p._creationTime,
          swipeCount: userSwipes.length,
          savedCount: library.filter((l) => l.userId === p.userId).length,
          lastActive: userSwipes.length
            ? Math.max(...userSwipes.map((s) => s._creationTime))
            : null,
        };
      }),
    };
  },
});

export const catalog = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "catalog.curate")) return null;
    const [tracks, swipes] = await Promise.all([
      ctx.db.query("tracks").collect(),
      ctx.db.query("swipes").collect(),
    ]);
    return tracks.map((t) => {
      const ts = swipes.filter((s) => s.trackId === t.trackId);
      const saves = ts.filter((s) => s.action === "save").length;
      const nevers = ts.filter((s) => s.action === "never").length;
      return { ...t, plays: ts.length, saves, nevers };
    });
  },
});

/** Per-user drill-down for the dashboard (requires users.view). */
export const userDetail = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "users.view")) return null;
    const profile = await ctx.db.get(profileId);
    if (!profile) return null;
    const swipes = await ctx.db
      .query("swipes")
      .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
      .collect();
    const byAction = { skip: 0, save: 0, more: 0, never: 0 };
    for (const s of swipes) byAction[s.action]++;
    const songs = await ctx.db
      .query("librarySongs")
      .withIndex("by_user_kind", (q) => q.eq("userId", profile.userId))
      .collect();
    const playlists = await ctx.db
      .query("playlists")
      .withIndex("by_user", (q) => q.eq("userId", profile.userId))
      .collect();
    return {
      email: profile.email,
      suspended: profile.suspended ?? false,
      byAction,
      savedCount: songs.length,
      playlistCount: playlists.length,
      recentSwipes: swipes.slice(-12).reverse(),
    };
  },
});

/** Suspend/unsuspend a user (requires users.manage). Admins can't be suspended. */
export const setSuspended = mutation({
  args: { profileId: v.id("profiles"), suspended: v.boolean() },
  handler: async (ctx, { profileId, suspended }) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "users.manage")) throw new Error("Requires users.manage");
    const target = await ctx.db.get(profileId);
    if (!target) throw new Error("No such user");
    if (target.isAdmin) throw new Error("Admins can't be suspended");
    await ctx.db.patch(profileId, { suspended });
  },
});

/** Wipe everything a user owns: swipes, library, playlists, profile. Admin only. */
export const deleteUserData = mutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const viewer = await getViewer(ctx);
    if (!viewer?.isAdmin) throw new Error("Admin only");
    const target = await ctx.db.get(profileId);
    if (!target) throw new Error("No such user");
    if (target.isAdmin) throw new Error("Demote the admin first");
    const userId = target.userId;
    const [swipes, songs, never, playlists] = await Promise.all([
      ctx.db.query("swipes").withIndex("by_userId", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("librarySongs").withIndex("by_user_kind", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("neverArtists").withIndex("by_user_artist", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("playlists").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    ]);
    for (const doc of [...swipes, ...songs, ...never, ...playlists]) {
      await ctx.db.delete(doc._id);
    }
    await ctx.db.delete(profileId);
  },
});

/** Promote/demote admins. The last remaining admin can't demote themself. */
export const setAdmin = mutation({
  args: { profileId: v.id("profiles"), isAdmin: v.boolean() },
  handler: async (ctx, { profileId, isAdmin }) => {
    const viewer = await getViewer(ctx);
    if (!viewer?.isAdmin) throw new Error("Admin only");
    if (!isAdmin) {
      const admins = (await ctx.db.query("profiles").collect()).filter((p) => p.isAdmin);
      if (admins.length === 1 && admins[0]._id === profileId) {
        throw new Error("Can't demote the last admin");
      }
    }
    await ctx.db.patch(profileId, { isAdmin });
  },
});

/** Only the admin can grant/revoke dashboard permissions. */
export const setPermission = mutation({
  args: {
    profileId: v.id("profiles"),
    permission: v.string(),
    granted: v.boolean(),
  },
  handler: async (ctx, { profileId, permission, granted }) => {
    const viewer = await getViewer(ctx);
    if (!viewer?.isAdmin) throw new Error("Admin only");
    if (!(PERMISSIONS as readonly string[]).includes(permission)) {
      throw new Error("Unknown permission");
    }
    const target = await ctx.db.get(profileId);
    if (!target) throw new Error("No such user");
    const current = new Set(target.permissions ?? []);
    if (granted) current.add(permission);
    else current.delete(permission);
    await ctx.db.patch(profileId, { permissions: [...current] });
  },
});
