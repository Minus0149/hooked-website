import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import {
  cleanAccent,
  cleanText,
  enforceRateLimit,
  requirePermission,
} from "./security";

/**
 * First-party house ads.
 *
 * No SDK, no network, no bidding: the admin writes the cards, the deck shows
 * them between swipes at a pace the admin sets, and everything is measurable
 * from our own tables.
 *
 * The pacing contract splits cleanly:
 *   server (authoritative) — daily impression cap + minimum cooldown, computed
 *     from adEvents so a cleared cache or a reinstalled app can't farm ads;
 *   client (pacing) — "one card every N swipes" and a warmup before the first
 *     one, because only the client knows how fast the thumb is moving.
 *
 * Config lives in appSettings under the key "ads":
 *   { enabled, everyNSwipes, cooldownMinutes, maxPerDay }
 * which encodes "1 per day" (maxPerDay:1), "every 10 minutes"
 * (cooldownMinutes:10) and anything in between.
 */

const ADS_CONFIG_KEY = "ads";
const EVENT_RETENTION_DAYS = 45;

export const AdsConfig = v.object({
  enabled: v.boolean(),
  /** show a card after this many organic swipes */
  everyNSwipes: v.number(),
  /** never two cards within this many minutes */
  cooldownMinutes: v.number(),
  /** hard ceiling per listener per UTC day */
  maxPerDay: v.number(),
  /** the wider weekly ceiling — the daily cap is the floor, this is the roof */
  maxPerWeek: v.number(),
});

export const DEFAULT_ADS_CONFIG = {
  enabled: true,
  everyNSwipes: 12,
  cooldownMinutes: 10,
  maxPerDay: 3,
  maxPerWeek: 15,
};

// ---------------------------------------------------------------- config

export interface AdsConfigValue {
  enabled: boolean;
  everyNSwipes: number;
  cooldownMinutes: number;
  maxPerDay: number;
  maxPerWeek: number;
}

async function readConfig(ctx: QueryCtx): Promise<AdsConfigValue> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", ADS_CONFIG_KEY))
    .unique();
  const value = row?.value as Partial<AdsConfigValue> | undefined;
  return {
    enabled: value?.enabled ?? DEFAULT_ADS_CONFIG.enabled,
    // clamped so one bad paste can't turn the deck into a billboard
    everyNSwipes: clamp(value?.everyNSwipes ?? DEFAULT_ADS_CONFIG.everyNSwipes, 3, 200),
    cooldownMinutes: clamp(
      value?.cooldownMinutes ?? DEFAULT_ADS_CONFIG.cooldownMinutes,
      0,
      24 * 60,
    ),
    maxPerDay: clamp(value?.maxPerDay ?? DEFAULT_ADS_CONFIG.maxPerDay, 0, 50),
    maxPerWeek: clamp(value?.maxPerWeek ?? DEFAULT_ADS_CONFIG.maxPerWeek, 0, 200),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.round(Number.isFinite(n) ? n : lo), lo), hi);
}

/** The pacing rules, readable by anyone — it shapes what the deck does. */
export const getConfig = query({
  args: {},
  handler: async (ctx) => readConfig(ctx),
});

/**
 * Write the pacing rules. Numbers are coerced through the same clamps the
 * reader applies, so the stored config is always sane.
 */
export const setConfig = mutation({
  args: {
    enabled: v.boolean(),
    everyNSwipes: v.number(),
    cooldownMinutes: v.number(),
    maxPerDay: v.number(),
    maxPerWeek: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ads.manage");
    // the daily cap floors the weekly one — a week can't be tighter than a day
    const maxPerDay = clamp(args.maxPerDay, 0, 50);
    const value = {
      enabled: args.enabled,
      everyNSwipes: clamp(args.everyNSwipes, 3, 200),
      cooldownMinutes: clamp(args.cooldownMinutes, 0, 24 * 60),
      maxPerDay,
      maxPerWeek: Math.max(clamp(args.maxPerWeek, 0, 200), maxPerDay),
    };
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", ADS_CONFIG_KEY))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value });
    else await ctx.db.insert("appSettings", { key: ADS_CONFIG_KEY, value });
    return value;
  },
});

// ---------------------------------------------------------------- CRUD

const MAX_AD_TEXT = { advertiser: 40, title: 80, body: 160, ctaLabel: 24 } as const;

/** Upload URL for ad artwork — admins/ads-managers only. */
export const generateAdUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "ads.manage");
    return await ctx.storage.generateUploadUrl();
  },
});

function cleanAdUrl(raw: string): string {
  const url = cleanText(raw, 400);
  if (!/^https:\/\//i.test(url)) throw new Error("The link must be https");
  return url;
}

export const listAds = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "ads.manage");
    const rows = await ctx.db.query("ads").collect();
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const urls = await Promise.all(
      rows.map(async (ad) =>
        ad.imageStorageId ? await ctx.storage.getUrl(ad.imageStorageId) : null,
      ),
    );
    return rows.map((ad, i) => ({ ...ad, imageUrl: urls[i] }));
  },
});

export const saveAd = mutation({
  args: {
    id: v.optional(v.id("ads")),
    advertiser: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    ctaLabel: v.string(),
    ctaUrl: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    accent: v.optional(v.string()),
    weight: v.number(),
    status: v.union(v.literal("draft"), v.literal("live"), v.literal("retired")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ads.manage");
    const now = new Date().toISOString();
    const doc = {
      advertiser: cleanText(args.advertiser, MAX_AD_TEXT.advertiser),
      title: cleanText(args.title, MAX_AD_TEXT.title),
      body: args.body ? cleanText(args.body, MAX_AD_TEXT.body) : undefined,
      ctaLabel: cleanText(args.ctaLabel, MAX_AD_TEXT.ctaLabel),
      ctaUrl: cleanAdUrl(args.ctaUrl),
      imageStorageId: args.imageStorageId,
      accent: args.accent ? cleanAccent(args.accent) : "#FFB627",
      weight: clamp(args.weight, 1, 20),
      status: args.status,
      updatedAt: now,
    };

    // retiring an ad drops its artwork file rather than leaking storage
    let previous: { imageStorageId?: import("./_generated/dataModel").Id<"_storage"> } | null =
      null;
    if (args.id) {
      previous = await ctx.db.get(args.id);
      if (!previous) throw new Error("No such ad");
    }

    if (args.id && previous) {
      if (
        args.status === "retired" &&
        previous.imageStorageId &&
        previous.imageStorageId !== args.imageStorageId
      ) {
        await ctx.storage.delete(previous.imageStorageId);
      }
      await ctx.db.patch(args.id, doc);
      return { id: args.id };
    }
    const id = await ctx.db.insert("ads", { ...doc, createdAt: now });
    return { id };
  },
});

// ---------------------------------------------------------------- serving

const dayKey = () => new Date().toISOString().slice(0, 10);

/**
 * The next card to show this listener, or null when any cap says no.
 *
 * Caps are evaluated against adEvents for TODAY (UTC). Anonymous listeners are
 * capped by their stable anonKey; signed-in ones by user id. A signed-in and
 * an anonymous identity on the same device get separate allowances — accepted;
 * the ceiling is three cards a day, not a bank control.
 */
export const nextAd = query({
  args: { userId: v.optional(v.string()), anonKey: v.optional(v.string()) },
  handler: async (ctx, { userId, anonKey }) => {
    const config = await readConfig(ctx);
    if (!config.enabled || config.maxPerDay === 0) return null;
    if (!userId && !anonKey) return null;

    const day = dayKey();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const seen = userId
      ? await ctx.db
          .query("adEvents")
          .withIndex("by_user_day", (q) =>
            q.eq("userId", userId).gte("day", weekAgo),
          )
          .collect()
      : anonKey
        ? await ctx.db
            .query("adEvents")
            .withIndex("by_anon_day", (q) =>
              q.eq("anonKey", anonKey).gte("day", weekAgo),
            )
            .collect()
        : [];

    const impressions = seen.filter((e) => e.kind === "impression");
    if (impressions.length >= config.maxPerWeek) return null;
    const todayKey = day;
    const todayImpressions = impressions.filter((e) => e.day === todayKey);
    if (todayImpressions.length >= config.maxPerDay) return null;

    // cooldown: the admin's spacing is the default, but a signed-in listener's
    // own time cadence (minutes/hours/per-day) takes over — the daily and
    // weekly caps above stay the hard ceiling, so denser cadences are still
    // bounded. One minute is the anti-spam floor.
    let cooldownMinutes = config.cooldownMinutes;
    if (userId) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      const cadence = profile?.prefs?.adCadence as
        | { unit: string; value: number }
        | undefined;
      if (cadence && cadence.unit !== "swipes" && cadence.value > 0) {
        const cadenceMin =
          cadence.unit === "minutes"
            ? cadence.value
            : cadence.unit === "hours"
              ? cadence.value * 60
              : Math.max(60, Math.round((24 * 60) / Math.max(1, cadence.value)));
        cooldownMinutes = Math.max(1, Math.min(cadenceMin, 24 * 60));
      }
    }
    if (cooldownMinutes > 0) {
      const last = impressions.reduce((m, e) => Math.max(m, e.at), 0);
      if (Date.now() - last < cooldownMinutes * 60_000) return null;
    }

    const live = await ctx.db
      .query("ads")
      .withIndex("by_status", (q) => q.eq("status", "live"))
      .collect();
    if (live.length === 0) return null;

    // weighted pick, biased away from whatever they just saw
    const recentIds = new Set(impressions.slice(-2).map((e) => e.adId));
    const pool = live.map((ad) => ({
      ad,
      weight: Math.max(0.25, ad.weight * (recentIds.has(ad._id) ? 0.4 : 1)),
    }));
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let roll = Math.random() * total;
    for (const p of pool) {
      roll -= p.weight;
      if (roll <= 0) {
        return {
          id: p.ad._id,
          advertiser: p.ad.advertiser,
          title: p.ad.title,
          body: p.ad.body,
          ctaLabel: p.ad.ctaLabel,
          ctaUrl: p.ad.ctaUrl,
          imageUrl: p.ad.imageStorageId ? await ctx.storage.getUrl(p.ad.imageStorageId) : null,
          accent: p.ad.accent ?? "#FFB627",
          seenToday: impressions.length,
        };
      }
    }
    return null;
  },
});

/**
 * Impression / click / skip.
 *
 * Identity is decided HERE, never taken from the caller: signed-in events key
 * to the authenticated user id, anonymous ones to the random per-install
 * anonKey (which is what makes the daily cap real for logged-out listeners —
 * previously they couldn't write events at all, so no cap applied). A client
 * cannot attribute events to someone else's account because it isn't asked.
 */
export const recordEvent = mutation({
  args: {
    adId: v.id("ads"),
    kind: v.union(v.literal("impression"), v.literal("click"), v.literal("skip")),
    /** ignored — kept in the schema of the call for client compatibility */
    userId: v.optional(v.string()),
    anonKey: v.optional(v.string()),
  },
  handler: async (ctx, { adId, kind, anonKey }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    const cleanAnon = anonKey ? cleanText(anonKey, 64) : undefined;
    if (!user && !cleanAnon) throw new Error("No identity");

    // one bucket per identity: an anon key that spams this still trips its own
    // limit without touching anyone else's
    const capKey = `ad-event:${user ? String(user._id) : cleanAnon}`;
    await enforceRateLimit(ctx, capKey, 120, 60 * 60_000);

    const ad = await ctx.db.get(adId);
    if (!ad) throw new Error("No such ad");

    await ctx.db.insert("adEvents", {
      userId: user ? String(user._id) : undefined,
      anonKey: user ? undefined : cleanAnon,
      adId,
      kind,
      day: dayKey(),
      at: Date.now(),
    });
  },
});

/**
 * Sweep old events. Runs nightly from crons.ts — without this the caps table
 * grows forever and the VPS pays for it in RAM and disk for zero benefit.
 */
export const sweepOldEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60_000;
    // ordered oldest-first; everything past the retention line goes
    const rows = await ctx.db.query("adEvents").order("asc").take(2000);
    let swept = 0;
    for (const event of rows) {
      if (event.at >= cutoff) break;
      await ctx.db.delete(event._id);
      swept++;
    }
    return { swept };
  },
});
