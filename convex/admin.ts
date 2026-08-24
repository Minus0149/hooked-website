import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { PERMISSIONS } from "./schema";
import { enforceRateLimit, requireAdmin, requirePermission } from "./security";
import { runtimeFor } from "./runtime";

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

const STATS_SNAPSHOT_KEY = "analytics:snapshot";

const dayKeyOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * The live ticker.
 *
 * This used to collect() every swipe in the database on every render — a
 * reactive query over an ever-growing table, i.e. a performance cliff wearing
 * a graph. Now the heavy numbers come from statsDaily (written by the
 * rollup cron), and only genuinely-recent rows are read: the last 400 swipes
 * for the activity sparklines and the recent list.
 */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "stats.view")) return null;

    const [profiles, dailyRows] = await Promise.all([
      ctx.db.query("profiles").collect(),
      // bounded to ~13 months of daily counters; older ones stop mattering
      ctx.db
        .query("statsDaily")
        .withIndex("by_day", (q) =>
          q.gte(
            "day",
            new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10),
          ),
        )
        .collect(),
    ]);
    const profileCount = profiles.length;
    const emailByUser = new Map(profiles.map((p) => [p.userId, p.email]));

    const byAction = { skip: 0, save: 0, more: 0, never: 0 };
    const todayKey = dayKeyOf(Date.now());
    let swipeCount = 0;
    for (const row of dailyRows) {
      swipeCount += row.saves + row.skips + row.nevers + row.mores;
      byAction.save += row.saves;
      byAction.skip += row.skips;
      byAction.more += row.mores;
      byAction.never += row.nevers;
    }
    const todayRow = dailyRows.find((r) => r.day === todayKey);
    const todayByAction = {
      save: todayRow?.saves ?? 0,
      skip: todayRow?.skips ?? 0,
      more: todayRow?.mores ?? 0,
      never: todayRow?.nevers ?? 0,
    };

    // recent tail only — enough for the sparklines and the live list
    const tail = await ctx.db
      .query("swipes")
      .withIndex("by_creation_time")
      .order("desc")
      .take(400);
    const recentAll = tail.reverse();

    const now = Date.now();
    const MIN_BUCKETS = 30;
    const activity = Array.from({ length: MIN_BUCKETS }, () => 0);
    const HOUR_BUCKETS = 24;
    const activityHours = Array.from({ length: HOUR_BUCKETS }, () => 0);
    for (const s of recentAll) {
      const ageMin = Math.floor((now - s._creationTime) / 60_000);
      if (ageMin >= 0 && ageMin < MIN_BUCKETS) activity[MIN_BUCKETS - 1 - ageMin]++;
      const ageHour = Math.floor((now - s._creationTime) / 3_600_000);
      if (ageHour >= 0 && ageHour < HOUR_BUCKETS) {
        activityHours[HOUR_BUCKETS - 1 - ageHour]++;
        todayByAction[s.action]++;
      }
    }

    // aggregate views come from the nightly snapshot when it exists; before
    // the first one lands they degrade to "computed from the recent tail",
    // which is honest about being partial rather than pretending completeness
    const snapshotRow = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", STATS_SNAPSHOT_KEY))
      .unique();
    const snapshot = snapshotRow?.value as
      | { topSaved?: unknown[]; topNever?: unknown[]; genres?: unknown[] }
      | undefined;

    type TopSaved = {
      trackId: string;
      count: number;
      title: string;
      artist: string;
      artwork: string;
    }[];
    type TopNever = { artist: string; count: number }[];
    type GenreStat = { genre: string; total: number; saves: number }[];

    const tally = <K extends string>(keyFn: (s: (typeof recentAll)[number]) => K) => {
      const m = new Map<K, number>();
      for (const s of recentAll) {
        const k = keyFn(s);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const topSaved =
      (snapshot?.topSaved as TopSaved | undefined) ??
      (() => {
        const saves = tally((s) => s.trackId);
        return [...saves.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([trackId]) => {
            const s = recentAll.find((x) => x.trackId === trackId)!;
            return { trackId, count: saves.get(trackId)!, title: s.title, artist: s.artist, artwork: s.artwork };
          });
      })();
    const topNever =
      (snapshot?.topNever as TopNever | undefined) ??
      [...tally((s) => (s.action === "never" ? s.artist : "")).entries()]
        .filter(([a]) => a)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([artist, count]) => ({ artist, count }));
    const genres =
      (snapshot?.genres as GenreStat | undefined) ??
      [...tally((s) => s.genre).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([genre, total]) => ({ genre, total, saves: 0 }));

    return {
      userCount: profileCount,
      swipeCount,
      byAction,
      todayByAction,
      saveRate: swipeCount > 0 ? byAction.save / swipeCount : 0,
      topSaved,
      topNever,
      genres,
      recent: recentAll
        .slice(-30)
        .reverse()
        .map((s) => ({ ...s, email: emailByUser.get(s.userId) ?? "unknown" })),
      activity,
      activityHours,
    };
  },
});

/**
 * The slower, wider view: growth, retention, the invite funnel and catalogue
 * health. Split from `stats` because that one re-runs on every swipe — this is
 * the report you open on purpose, not the ticker.
 */
/**
 * The full analytics computation, run OFFLINE.
 *
 * This body used to live inside a reactive query that collected() eight whole
 * tables every time an admin opened the dashboard — fine at a hundred swipes,
 * a slow death at a million. Now it runs on a schedule (and on demand), and
 * its result is stored as one JSON blob the dashboard reads instantly.
 */
async function computeAnalyticsPayload(ctx: QueryCtx, spanDaysOverride?: number) {
    const runtime = await runtimeFor(ctx);
    const now = Date.now();
    const DAY_MS = 86_400_000;
    /** A gap this long between two swipes means the user put the phone down. */
    const SESSION_GAP_MS = runtime.sessionGapMinutes * 60_000;
    /** best/worst-hook panels need at least this much evidence */
    const MIN_HOOK_PLAYS = runtime.bestHookMinPlays;

    const span = Math.min(Math.max(spanDaysOverride ?? runtime.analyticsSpanDays, 7), 90);
    const dayOf = (ts: number) => Math.floor(ts / DAY_MS);
    const today = dayOf(now);
    const from = today - (span - 1);

    const [swipes, profiles, tracks, hooks, hookStats, requests, creators, library] =
      await Promise.all([
        ctx.db.query("swipes").collect(),
        ctx.db.query("profiles").collect(),
        ctx.db.query("tracks").collect(),
        ctx.db.query("hooks").collect(),
        ctx.db.query("hookStats").collect(),
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
    const statOf = new Map(hookStats.map((s) => [String(s.hookId), s]));
    const counts = (id: string) => statOf.get(id) ?? { plays: 0, saves: 0, skips: 0 };

    const byPosition = new Map<number, { plays: number; saves: number; hooks: number }>();
    for (const h of hooks) {
      if (!h.active) continue;
      const c = counts(String(h._id));
      const slot = byPosition.get(h.order) ?? { plays: 0, saves: 0, hooks: 0 };
      slot.plays += c.plays;
      slot.saves += c.saves;
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
      .filter((h) => h.active && counts(String(h._id)).plays >= MIN_HOOK_PLAYS)
      .map((h) => {
        const c = counts(String(h._id));
        return {
          hookId: h._id,
          trackId: h.trackId,
          title: titleFor.get(h.trackId)?.title ?? h.trackId,
          artist: titleFor.get(h.trackId)?.artist ?? "",
          artwork: titleFor.get(h.trackId)?.artwork ?? "",
          label: h.label,
          order: h.order,
          startMs: h.startMs,
          plays: c.plays,
          saves: c.saves,
          rate: c.saves / c.plays,
        };
      })
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
        // both sides of this come from today's bucket; `dau` above is a rolling
        // 24 hours, which would quietly mix two different windows
        swipesPerActive: (() => {
          const today = series[series.length - 1];
          return today && today.dau > 0 ? today.swipes / today.dau : 0;
        })(),
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
}

/**
 * The dashboard's analytics panel reads this stored snapshot — O(1), zero
 * table scans at read time. Recomputed nightly by cron and on demand via
 * refreshAnalytics.
 */
export const analytics = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "stats.view")) return null;
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", STATS_SNAPSHOT_KEY))
      .unique();
    if (!row) return null;
    // the snapshot IS the payload; computedAt rides inside it
    return row.value as { computedAt?: string };
  },
});

/** On-demand recompute for the "refresh" button. Bounded like the cron run. */
export const refreshAnalytics = mutation({
  args: {},
  handler: async (ctx): Promise<{ computedAt: string } | null> => {
    const viewer = await getViewer(ctx);
    if (!hasPerm(viewer, "stats.view")) return null;
    await enforceRateLimit(
      ctx,
      `analytics:recompute:${viewer!.userId}`,
      4,
      60 * 60_000,
    );
    return await ctx.runMutation(internal.admin.computeSnapshot, { spanDays: undefined });
  },
});

export const computeSnapshot = internalMutation({
  args: { spanDays: v.optional(v.number()) },
  handler: async (ctx, { spanDays }) => {
    const payload = {
      ...computeAnalyticsPayload(ctx, spanDays),
      computedAt: new Date().toISOString(),
    };
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", STATS_SNAPSHOT_KEY))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value: payload });
    else await ctx.db.insert("appSettings", { key: STATS_SNAPSHOT_KEY, value: payload });
    return { computedAt: payload.computedAt };
  },
});

const WATERMARK_KEY = "stats:watermark";

async function readWatermark(ctx: QueryCtx): Promise<number> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", WATERMARK_KEY))
    .unique();
  return typeof row?.value?.ms === "number" ? row.value.ms : 0;
}

/**
 * Fold everything written since the last run into statsDaily.
 *
 * Runs every few minutes from crons.ts. Each run only touches rows newer than
 * its watermark, so the cost is proportional to recent activity, not to the
 * size of history — that's what keeps `stats` cheap enough to be reactive.
 */
export const rollupStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const wm = await readWatermark(ctx);
    const CAP = 5000;

    const blankDay = () => ({ saves: 0, skips: 0, nevers: 0, mores: 0, signups: 0, requests: 0, imports: 0 });
    const days = new Map<string, ReturnType<typeof blankDay>>();
    let lastSeen = wm;
    let truncated = false;

    // ---- swipes ---------------------------------------------------------
    let swipes = 0;
    const swipeRows = await ctx.db
      .query("swipes")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", wm))
      .take(CAP);
    for (const s of swipeRows) {
      lastSeen = Math.max(lastSeen, s._creationTime);
      const day = dayKeyOf(s._creationTime);
      const bucket = days.get(day) ?? days.set(day, blankDay()).get(day)!;
      bucket[
        s.action === "save" ? "saves" : s.action === "skip" ? "skips" : s.action === "more" ? "mores" : "nevers"
      ]++;
      swipes++;
    }
    if (swipeRows.length >= CAP) truncated = true;

    // ---- signups / requests / imports -----------------------------------
    const [profiles, requests, imports] = await Promise.all([
      ctx.db.query("profiles").collect(),
      ctx.db.query("accessRequests").collect(),
      ctx.db.query("imports").collect(),
    ]);
    for (const p of profiles) {
      if (p._creationTime <= wm) continue;
      lastSeen = Math.max(lastSeen, p._creationTime);
      const bucket = days.get(dayKeyOf(p._creationTime)) ?? days.set(dayKeyOf(p._creationTime), blankDay()).get(dayKeyOf(p._creationTime))!;
      bucket.signups++;
    }
    for (const r of requests) {
      const ts = Date.parse(r.submittedAt);
      if (Number.isNaN(ts) || ts <= wm) continue;
      lastSeen = Math.max(lastSeen, ts);
      const bucket = days.get(dayKeyOf(ts)) ?? days.set(dayKeyOf(ts), blankDay()).get(dayKeyOf(ts))!;
      bucket.requests++;
    }
    for (const i of imports) {
      const ts = Date.parse(i.createdAt);
      if (Number.isNaN(ts) || ts <= wm) continue;
      lastSeen = Math.max(lastSeen, ts);
      const bucket = days.get(dayKeyOf(ts)) ?? days.set(dayKeyOf(ts), blankDay()).get(dayKeyOf(ts))!;
      bucket.imports++;
    }

    // ---- write the daily rows -------------------------------------------
    for (const [day, b] of days) {
      const existing = await ctx.db
        .query("statsDaily")
        .withIndex("by_day", (q) => q.eq("day", day))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          saves: existing.saves + b.saves,
          skips: existing.skips + b.skips,
          nevers: existing.nevers + b.nevers,
          mores: existing.mores + b.mores,
          signups: existing.signups + b.signups,
          requests: existing.requests + b.requests,
          imports: existing.imports + b.imports,
        });
      } else {
        await ctx.db.insert("statsDaily", { day, ...b });
      }
    }

    // advance the watermark only as far as we actually processed — a truncated
    // run resumes exactly where it stopped rather than skipping rows
    const newWm = truncated && swipeRows.length > 0 ? swipeRows[swipeRows.length - 1]._creationTime : Math.max(lastSeen, wm);
    const wmRow = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", WATERMARK_KEY))
      .unique();
    if (wmRow) await ctx.db.patch(wmRow._id, { value: { ms: newWm } });
    else await ctx.db.insert("appSettings", { key: WATERMARK_KEY, value: { ms: newWm } });

    return { swipes, days: days.size, truncated };
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
