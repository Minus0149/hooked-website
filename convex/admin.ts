import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { PERMISSIONS } from "./schema";
import { enforceRateLimit, requireAdmin, requirePermission } from "./security";

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

const DAY_MS = 86_400_000;
/** A gap this long between two swipes means the user put the phone down. */
const SESSION_GAP_MS = 30 * 60_000;

/**
 * The slower, wider view: growth, retention, the invite funnel and catalogue
 * health. Split from `stats` because that one re-runs on every swipe — this is
 * the report you open on purpose, not the ticker.
 */
export const analytics = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "stats.view")) return null;

    const span = Math.min(Math.max(days ?? 30, 7), 90);
    const now = Date.now();
    const dayOf = (ts: number) => Math.floor(ts / DAY_MS);
    const today = dayOf(now);
    const from = today - (span - 1);

    const [swipes, profiles, tracks, hooks, requests, creators, library] =
      await Promise.all([
        ctx.db.query("swipes").collect(),
        ctx.db.query("profiles").collect(),
        ctx.db.query("tracks").collect(),
        ctx.db.query("hooks").collect(),
        ctx.db.query("accessRequests").collect(),
        ctx.db.query("creators").collect(),
        ctx.db.query("librarySongs").collect(),
      ]);

    // ---- daily series: one row per day, oldest first --------------------
    const blank = () => ({ swipes: 0, saves: 0, signups: 0, requests: 0, users: new Set<string>() });
    const byDay = new Map<number, ReturnType<typeof blank>>();
    for (let d = from; d <= today; d++) byDay.set(d, blank());

    for (const s of swipes) {
      const bucket = byDay.get(dayOf(s._creationTime));
      if (!bucket) continue;
      bucket.swipes++;
      bucket.users.add(s.userId);
      if (s.action === "save") bucket.saves++;
    }
    for (const p of profiles) {
      const bucket = byDay.get(dayOf(p._creationTime));
      if (bucket) bucket.signups++;
    }
    for (const r of requests) {
      const ts = Date.parse(r.submittedAt);
      if (!Number.isNaN(ts)) {
        const bucket = byDay.get(dayOf(ts));
        if (bucket) bucket.requests++;
      }
    }

    const series = [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, b]) => ({
        date: new Date(day * DAY_MS).toISOString().slice(0, 10),
        dau: b.users.size,
        swipes: b.swipes,
        saves: b.saves,
        signups: b.signups,
        requests: b.requests,
      }));

    // ---- rolling active counts -----------------------------------------
    const activeSince = (cutoffDays: number) => {
      const cutoff = now - cutoffDays * DAY_MS;
      const set = new Set<string>();
      for (const s of swipes) if (s._creationTime >= cutoff) set.add(s.userId);
      return set.size;
    };
    const dau = activeSince(1);
    const wau = activeSince(7);
    const mau = activeSince(30);

    // ---- retention: did they come back the next day, and a week later? --
    const daysActive = new Map<string, Set<number>>();
    for (const s of swipes) {
      const set = daysActive.get(s.userId) ?? new Set<number>();
      set.add(dayOf(s._creationTime));
      daysActive.set(s.userId, set);
    }
    let d1Eligible = 0, d1Back = 0, d7Eligible = 0, d7Back = 0;
    for (const [, set] of daysActive) {
      const first = Math.min(...set);
      // only count a user once the window has actually elapsed for them
      if (first + 1 <= today) {
        d1Eligible++;
        if (set.has(first + 1)) d1Back++;
      }
      if (first + 7 <= today) {
        d7Eligible++;
        for (let d = first + 1; d <= first + 7; d++) {
          if (set.has(d)) { d7Back++; break; }
        }
      }
    }

    // ---- sessions: a burst of swipes with no 30-minute gap in it --------
    const perUser = new Map<string, number[]>();
    for (const s of swipes) {
      const arr = perUser.get(s.userId) ?? [];
      arr.push(s._creationTime);
      perUser.set(s.userId, arr);
    }
    let sessions = 0;
    let longestSession = 0;
    for (const [, times] of perUser) {
      times.sort((a, b) => a - b);
      let count = 0;
      for (let i = 0; i < times.length; i++) {
        if (i === 0 || times[i] - times[i - 1] > SESSION_GAP_MS) {
          sessions++;
          count = 1;
        } else {
          count++;
        }
        longestSession = Math.max(longestSession, count);
      }
    }

    // ---- the invite funnel, end to end ---------------------------------
    const emailToProfile = new Map(profiles.map((p) => [p.email.toLowerCase(), p]));
    const swipedUsers = new Set(swipes.map((s) => s.userId));
    const savedUsers = new Set(library.map((l) => l.userId));
    const approved = requests.filter((r) => r.status === "approved");
    let signedUp = 0, activated = 0, saved = 0;
    for (const r of approved) {
      const profile = emailToProfile.get(r.email.toLowerCase());
      if (!profile) continue;
      signedUp++;
      if (swipedUsers.has(profile.userId)) activated++;
      if (savedUsers.has(profile.userId)) saved++;
    }
    const funnel = {
      requested: requests.length,
      approved: approved.length,
      signedUp,
      activated,
      saved,
      // signups that never went through the queue (admins, pre-gate accounts)
      ungated: profiles.length - signedUp,
      pending: requests.filter((r) => r.status === "pending").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
      bySource: {
        app: requests.filter((r) => r.source === "app").length,
        landing: requests.filter((r) => r.source === "landing").length,
      },
    };

    // ---- catalogue health ----------------------------------------------
    const hooksByTrack = new Map<string, typeof hooks>();
    for (const h of hooks) {
      const arr = hooksByTrack.get(h.trackId) ?? [];
      arr.push(h);
      hooksByTrack.set(h.trackId, arr);
    }
    const playsByTrack = new Map<string, number>();
    for (const s of swipes) {
      playsByTrack.set(s.trackId, (playsByTrack.get(s.trackId) ?? 0) + 1);
    }

    let published = 0, withHook = 0, multiHook = 0, noAudio = 0, unplayed = 0, dead = 0;
    for (const t of tracks) {
      const active = (hooksByTrack.get(t.trackId) ?? []).filter((h) => h.active);
      const live = t.hidden !== true;
      if (live) published++;
      if (active.length > 0) withHook++;
      if (active.length > 1) multiHook++;
      if (!t.previewUrl && !t.audioStorageId) noAudio++;
      if (!playsByTrack.get(t.trackId)) unplayed++;
      // live in the feed but unplayable or unmarked — these waste a card
      if (live && (active.length === 0 || (!t.previewUrl && !t.audioStorageId))) dead++;
    }

    // ---- does a second hook ever beat the first? ------------------------
    const byPosition = new Map<number, { plays: number; saves: number; hooks: number }>();
    for (const h of hooks) {
      if (!h.active) continue;
      const slot = byPosition.get(h.order) ?? { plays: 0, saves: 0, hooks: 0 };
      slot.plays += h.plays;
      slot.saves += h.saves;
      slot.hooks++;
      byPosition.set(h.order, slot);
    }
    const hookPositions = [...byPosition.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 6)
      .map(([order, s]) => ({
        order,
        hooks: s.hooks,
        plays: s.plays,
        saves: s.saves,
        rate: s.plays > 0 ? s.saves / s.plays : 0,
      }));

    const titleFor = new Map(tracks.map((t) => [t.trackId, t]));
    const scored = hooks
      .filter((h) => h.active && h.plays >= 10)
      .map((h) => ({
        hookId: h._id,
        trackId: h.trackId,
        title: titleFor.get(h.trackId)?.title ?? h.trackId,
        artist: titleFor.get(h.trackId)?.artist ?? "",
        artwork: titleFor.get(h.trackId)?.artwork ?? "",
        label: h.label,
        order: h.order,
        startMs: h.startMs,
        plays: h.plays,
        saves: h.saves,
        rate: h.saves / h.plays,
      }))
      .sort((a, b) => b.rate - a.rate);

    // ---- creators -------------------------------------------------------
    const tracksByOwner = new Map<string, number>();
    for (const t of tracks) {
      if (t.ownerUserId) {
        tracksByOwner.set(t.ownerUserId, (tracksByOwner.get(t.ownerUserId) ?? 0) + 1);
      }
    }

    return {
      span,
      series,
      live: {
        dau,
        wau,
        mau,
        stickiness: mau > 0 ? dau / mau : 0, // DAU/MAU — the habit number
        swipesPerActive: dau > 0 ? series[series.length - 1].swipes / dau : 0,
      },
      retention: {
        d1: d1Eligible > 0 ? d1Back / d1Eligible : 0,
        d1Eligible,
        d7: d7Eligible > 0 ? d7Back / d7Eligible : 0,
        d7Eligible,
      },
      sessions: {
        count: sessions,
        swipesPer: sessions > 0 ? swipes.length / sessions : 0,
        perUser: perUser.size > 0 ? sessions / perUser.size : 0,
        longest: longestSession,
      },
      funnel,
      catalogue: {
        total: tracks.length,
        published,
        withHook,
        multiHook,
        noAudio,
        unplayed,
        dead,
        hooks: hooks.length,
        hooksPerTrack: tracks.length > 0 ? hooks.length / tracks.length : 0,
      },
      hookPositions,
      bestHooks: scored.slice(0, 6),
      // the tail, never overlapping the top — a hook here is one to re-cut
      worstHooks: scored.slice(6).slice(-6).reverse(),
      creators: {
        total: creators.length,
        pending: creators.filter((c) => c.status === "pending").length,
        approved: creators.filter((c) => c.status === "approved").length,
        top: creators
          .filter((c) => c.status === "approved")
          .map((c) => ({
            artistName: c.artistName,
            email: c.email,
            tracks: tracksByOwner.get(c.userId) ?? 0,
          }))
          .sort((a, b) => b.tracks - a.tracks)
          .slice(0, 6),
      },
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
    const { user } = await requirePermission(ctx, "users.manage");
    await enforceRateLimit(ctx, `admin:suspend:${user.id}`, 60, 60_000);
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
    const { user } = await requireAdmin(ctx);
    await enforceRateLimit(ctx, `admin:delete-user:${user.id}`, 10, 10 * 60_000);
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
    const { user } = await requireAdmin(ctx);
    await enforceRateLimit(ctx, `admin:set-admin:${user.id}`, 30, 60_000);
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
    const { user } = await requireAdmin(ctx);
    await enforceRateLimit(ctx, `admin:set-permission:${user.id}`, 60, 60_000);
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
