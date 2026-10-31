import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DECK_EVENT_DAILY, deckCountsFor, deckLive } from "./featureRules";
import { authComponent } from "./auth";
import { isMood } from "./moods";
import { cleanText, enforceRateLimit, getProfile, requirePermission } from "./security";

/**
 * Sponsored mood decks: a brand presents a deck (a mood and/or genre, and
 * optionally hand-picked songs) for a date range. Listeners see it as a chip
 * on Home labelled "presented by <brand>" and "Sponsored" (ASCI). The sponsor
 * gets impressions, opens and plays per day — counts only. No listener id is
 * stored anywhere in this module, and nothing is shared with the brand.
 */

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Decks live right now. Public: Home shows them. */
export const live = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("sponsoredDecks")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(20);
    return rows
      .filter((d) => deckLive(d, now))
      .map((d) => ({
        id: d._id,
        brand: d.brand,
        logoUrl: d.logoUrl ?? null,
        title: d.title,
        mood: d.mood ?? null,
        genre: d.genre ?? null,
        trackIds: d.trackIds,
      }));
  },
});

/**
 * Count an impression (chip seen), an open (deck started) or a play (a song
 * dealt inside the deck). Only signed-in listeners count (featureRules
 * deckCountsFor): guests still see decks, they just aren't in the report. Each
 * account counts a few times a day per deck at most; no id is stored with the
 * counts. `anonKey` is still accepted from older app builds and ignored.
 */
export const record = mutation({
  args: {
    deckId: v.id("sponsoredDecks"),
    event: v.union(v.literal("impression"), v.literal("open"), v.literal("play")),
    anonKey: v.optional(v.string()),
  },
  handler: async (ctx, { deckId, event }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return;
    const who = String(user._id);
    if (!deckCountsFor(await getProfile(ctx, who))) return;
    await enforceRateLimit(ctx, `deck:${event}:${who}`, event === "play" ? 60 : 20, 60 * 60_000);
    const deck = await ctx.db.get(deckId);
    if (!deck || !deckLive(deck, Date.now())) return;
    // past the day's allowance for this deck: quietly not counted
    try {
      await enforceRateLimit(ctx, `deck:day:${event}:${deckId}:${who}`, DECK_EVENT_DAILY[event], 86_400_000);
    } catch {
      return;
    }
    const day = dayOf(Date.now());
    const row = await ctx.db
      .query("sponsoredDeckStats")
      .withIndex("by_deck_day", (q) => q.eq("deckId", deckId).eq("day", day))
      .unique();
    const key = event === "impression" ? "impressions" : event === "open" ? "opens" : "plays";
    if (row) await ctx.db.patch(row._id, { [key]: row[key] + 1 });
    else await ctx.db.insert("sponsoredDeckStats", { deckId, day, impressions: 0, opens: 0, plays: 0, [key]: 1 });
  },
});

/** Every deck with its per-day counts, for the admin and the sponsor report. */
export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "ads.manage");
    const decks = await ctx.db.query("sponsoredDecks").order("desc").take(100);
    const out = [];
    for (const d of decks) {
      const days = await ctx.db
        .query("sponsoredDeckStats")
        .withIndex("by_deck_day", (q) => q.eq("deckId", d._id))
        .collect();
      out.push({
        ...d,
        live: deckLive(d, Date.now()),
        days: days.map((s) => ({ day: s.day, impressions: s.impressions, opens: s.opens, plays: s.plays })),
      });
    }
    return out;
  },
});

const deckArgs = {
  brand: v.string(),
  logoUrl: v.optional(v.string()),
  title: v.string(),
  mood: v.optional(v.string()),
  genre: v.optional(v.string()),
  trackIds: v.array(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
  active: v.boolean(),
};

function cleanDeck(a: {
  brand: string;
  logoUrl?: string;
  title: string;
  mood?: string;
  genre?: string;
  trackIds: string[];
  startsAt: number;
  endsAt: number;
  active: boolean;
}) {
  const brand = cleanText(a.brand, 60);
  const title = cleanText(a.title, 60);
  if (brand.length < 2 || title.length < 2) throw new ConvexError("A deck needs a brand and a title.");
  const mood = a.mood ? cleanText(a.mood, 20) : undefined;
  if (mood && !isMood(mood)) throw new ConvexError("Unknown mood.");
  const genre = a.genre ? cleanText(a.genre, 40) || undefined : undefined;
  const trackIds = [...new Set(a.trackIds.map((t) => cleanText(t, 120)).filter(Boolean))].slice(0, 50);
  if (!mood && !genre && trackIds.length === 0) throw new ConvexError("Give the deck a mood, a genre or some songs.");
  const logo = a.logoUrl ? cleanText(a.logoUrl, 500) : undefined;
  if (logo && !/^https:\/\//.test(logo)) throw new ConvexError("The logo must be an https URL.");
  if (!(a.endsAt > a.startsAt)) throw new ConvexError("The deck must end after it starts.");
  return { brand, title, mood, genre, trackIds, logoUrl: logo, startsAt: a.startsAt, endsAt: a.endsAt, active: a.active };
}

export const create = mutation({
  args: deckArgs,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ads.manage");
    return ctx.db.insert("sponsoredDecks", { ...cleanDeck(args), createdAt: Date.now() });
  },
});

export const setActive = mutation({
  args: { deckId: v.id("sponsoredDecks"), active: v.boolean() },
  handler: async (ctx, { deckId, active }) => {
    await requirePermission(ctx, "ads.manage");
    await ctx.db.patch(deckId, { active });
  },
});
