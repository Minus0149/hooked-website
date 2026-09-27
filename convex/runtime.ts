import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requirePermission } from "./security";

/**
 * The runtime configuration — every number the product behaves by, editable
 * from the admin dashboard and pushed LIVE to every open client.
 *
 * Convex queries are reactive: when an admin saves, `get` re-fires everywhere
 * it's subscribed, and the gate, the deck pacing and the analytics windows
 * change without a deploy. That's the whole point of this file: nothing here
 * is allowed to also exist as a hardcoded constant.
 *
 * Deliberately NOT here: security rate limits (moving those live is a
 * footgun), schema constraints, and hook length bounds (they protect data
 * integrity, not behaviour).
 */

const KEY = "runtime";

export const RUNTIME_DEFAULTS = {
  /** anonymous swipes before the sign-in wall */
  gateFreeSwipes: 5,
  /** a browser import run older than this is declared dead */
  importStaleMinutes: 30,
  /** save-rate hook ranking needs at least this much evidence */
  hookRankMinPlays: 20,
  /** analytics best/worst-hooks panels need at least this much evidence */
  bestHookMinPlays: 10,
  /** analytics: a swipe gap longer than this starts a new session */
  sessionGapMinutes: 30,
  /** analytics snapshot window in days */
  analyticsSpanDays: 30,
  /**
   * How hard "people who liked this liked that" pulls on the deck, in places
   * a song may jump. Zero switches the recommender off without a deploy —
   * which is the whole reason it is a dial and not a constant.
   */
  recsStrength: 9,
  /** listeners who must have reacted to a track before it can be modelled */
  recsMinRaters: 3,
  /** listeners who must link a pair before that pair is published */
  recsMinSupport: 2,
  /**
   * How hard the face someone picked pulls on the deck, in places. Highest of
   * the ranking terms by default, because it is the only one about *now*.
   * Zero turns the mood lens into decoration without a deploy.
   */
  moodStrength: 16,
  /** Listeners who must agree before a mood tag is published to everyone. */
  moodMinVotes: 2,
  /**
   * How hard the model each device trains on its own listener's swipes may
   * pull, in places. It is already damped by its own confidence, so this is
   * the ceiling it reaches once there is real evidence — not what a first
   * session gets.
   */
  modelStrength: 12,
  /**
   * Apple chart feeds pulled per scheduled catalogue refresh. There are 32
   * of them (convex/catalogRules.ts FEEDS), so 16 covers the lot every two
   * days. Zero stops the job — the off switch for the only thing in here that
   * reaches outside on a timer.
   */
  chartFeedsPerRun: 16,
  /**
   * Hours between background rebuilds of the catalogue file. Every rebuild
   * re-reads the whole tracks table and every open app downloads the new
   * file, so rebuilding 20 s after each analyser/chart write blew through the
   * free plan (3.17 GB of file writes in a few days, 2026-09-27). Admin actions
   * — hiding a song, a creator publishing — still rebuild within a minute.
   */
  catalogRebuildHours: 12,
  /**
   * The oldest Android build (versionCode) still allowed to run. Phones below
   * it get Play's full-screen update and can't continue without it; above it,
   * a newer build is only offered. 0 = never force. See mobile storeUpdate.ts.
   */
  minAndroidVersionCode: 0,
  /**
   * Percent of the deck that is Indian music for a listener who picked no
   * language (guests, "just the hits"). 0 turns the mix off and leaves it to
   * the shuffle. Read by the clients' rankPool (src/data/ranking.ts).
   */
  indiaSharePct: 60,
  /**
   * Percent of the deck in a language the listener picked at onboarding. The
   * rest is discovery, so an English-only listener meets some Hindi without
   * being buried in it. 0 turns it off.
   */
  pickedLangPct: 80,
  /** Most songs one artist may have dealable at once; curation hides the rest. */
  artistCap: 3,
  /** Weeks off every chart before a song stops being dealt (it stays in libraries). */
  staleWeeks: 8,
  /** Songs released more than this many years ago are dealt only while charting. */
  maxAgeYears: 5,
  /**
   * What "while charting" means for those: a chart carried it within this
   * many days. A full sweep of the feeds takes two nights at 16 a night.
   */
  oldChartDays: 14,
  /**
   * How many friends each listener's invite link may approve straight past
   * the waitlist (convex/referrals.ts). Zero switches invite links off.
   */
  referralCap: 3,
  /**
   * Which hook start the players get (convex/hookRules.ts): 0 = the whole
   * preview from 0, 1 = the no-model loudness heuristic, 2 = auto (the
   * structure model when confident, otherwise the whole preview). Changing it
   * takes effect on "Apply to all songs" in the Hook check tab.
   */
  hookPolicy: 2,
} as const;

export type RuntimeKey = keyof typeof RUNTIME_DEFAULTS;

/** [min, max] sanity bounds per key — one bad paste can't break the product. */
const BOUNDS: Record<RuntimeKey, [number, number]> = {
  gateFreeSwipes: [0, 100],
  importStaleMinutes: [5, 24 * 60],
  hookRankMinPlays: [1, 10_000],
  bestHookMinPlays: [1, 10_000],
  sessionGapMinutes: [5, 12 * 60],
  analyticsSpanDays: [7, 90],
  recsStrength: [0, 40],
  recsMinRaters: [2, 50],
  recsMinSupport: [1, 50],
  chartFeedsPerRun: [0, 100],
  catalogRebuildHours: [0.25, 48],
  minAndroidVersionCode: [0, 100_000],
  indiaSharePct: [0, 100],
  pickedLangPct: [0, 100],
  artistCap: [1, 50],
  staleWeeks: [1, 520],
  maxAgeYears: [1, 100],
  oldChartDays: [1, 365],
  moodStrength: [0, 40],
  moodMinVotes: [1, 50],
  modelStrength: [0, 40],
  referralCap: [0, 50],
  hookPolicy: [0, 2],
};

export type RuntimeConfig = Record<RuntimeKey, number>;

const clampKey = (key: RuntimeKey, n: unknown): number => {
  const [lo, hi] = BOUNDS[key];
  const value = typeof n === "number" && Number.isFinite(n) ? n : RUNTIME_DEFAULTS[key];
  return Math.min(Math.max(Math.round(value), lo), hi);
};

async function readRuntime(ctx: QueryCtx | MutationCtx): Promise<RuntimeConfig> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
  const stored = (row?.value ?? {}) as Partial<Record<RuntimeKey, unknown>>;
  const out = {} as RuntimeConfig;
  for (const key of Object.keys(RUNTIME_DEFAULTS) as RuntimeKey[]) {
    out[key] =
      stored[key] === undefined ? RUNTIME_DEFAULTS[key] : clampKey(key, stored[key]);
  }
  return out;
}

/**
 * Live, public, reactive. Clients subscribe to this and re-render when an
 * admin saves — that IS the push mechanism.
 */
export const get = query({
  args: {},
  handler: async (ctx) => readRuntime(ctx),
});

/** Patch any subset. Unknown keys are ignored, values are clamped. */
export const set = mutation({
  args: {
    gateFreeSwipes: v.optional(v.number()),
    importStaleMinutes: v.optional(v.number()),
    hookRankMinPlays: v.optional(v.number()),
    bestHookMinPlays: v.optional(v.number()),
    sessionGapMinutes: v.optional(v.number()),
    analyticsSpanDays: v.optional(v.number()),
    recsStrength: v.optional(v.number()),
    recsMinRaters: v.optional(v.number()),
    recsMinSupport: v.optional(v.number()),
    chartFeedsPerRun: v.optional(v.number()),
    catalogRebuildHours: v.optional(v.number()),
    minAndroidVersionCode: v.optional(v.number()),
    indiaSharePct: v.optional(v.number()),
    pickedLangPct: v.optional(v.number()),
    artistCap: v.optional(v.number()),
    staleWeeks: v.optional(v.number()),
    maxAgeYears: v.optional(v.number()),
    oldChartDays: v.optional(v.number()),
    moodStrength: v.optional(v.number()),
    moodMinVotes: v.optional(v.number()),
    modelStrength: v.optional(v.number()),
    referralCap: v.optional(v.number()),
    hookPolicy: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "config.manage");
    const current = await readRuntime(ctx);
    const next = { ...current };
    for (const key of Object.keys(RUNTIME_DEFAULTS) as RuntimeKey[]) {
      if (args[key] !== undefined) next[key] = clampKey(key, args[key]);
    }
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value: next });
    else await ctx.db.insert("appSettings", { key: KEY, value: next });
    return next;
  },
});

/** Internal read for server-side consumers (crons, mutations). */
export const runtimeFor = readRuntime;
