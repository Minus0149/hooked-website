import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { featuredEmail } from "./emailTemplate";
import { BLURB_MAX, isWeekKey, weekOf } from "./featureRules";
import { publicTrack } from "./promotions";
import { cleanText, getProfile, requirePermission, requireUser } from "./security";

/**
 * Indie hook of the week: an admin picks one artist upload per week, with a
 * short blurb. It leads Home in both apps for that week, labelled "indie hook
 * of the week" — never "promoted", because nobody paid — and the artist is
 * emailed a link to share (hookedcue.com/indie-hook).
 */

const SHARE_URL = "https://hookedcue.com/indie-hook";

async function pickFor(ctx: QueryCtx, week: string) {
  return ctx.db
    .query("featuredHooks")
    .withIndex("by_week", (q) => q.eq("week", week))
    .unique();
}

/** This week's pick with a playable track, or null. Public: it's on Home. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const week = weekOf(Date.now());
    const pick = await pickFor(ctx, week);
    if (!pick) return null;
    const track = await publicTrack(ctx, pick.trackId);
    if (!track) return null;
    return { week, blurb: pick.blurb, track };
  },
});

/** Past and present picks, newest first. Public: the share page lists them. */
export const archive = query({
  args: {},
  handler: async (ctx) => {
    const picks = await ctx.db.query("featuredHooks").withIndex("by_week").order("desc").take(52);
    const out = [];
    for (const p of picks) {
      const t = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", p.trackId))
        .unique();
      if (!t || t.hidden) continue;
      out.push({ week: p.week, blurb: p.blurb, trackId: t.trackId, title: t.title, artist: t.artist, artwork: t.artwork });
    }
    return out;
  },
});

/** Songs an admin can feature: published artist uploads. */
export const candidates = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog.curate");
    const owned = await ctx.db
      .query("tracks")
      .withIndex("by_owner", (q) => q.gt("ownerUserId", ""))
      .take(500);
    return owned
      .filter((t) => !t.hidden)
      .map((t) => ({ trackId: t.trackId, title: t.title, artist: t.artist, artwork: t.artwork }));
  },
});

/** Set (or replace) a week's pick and email the artist. */
export const setPick = mutation({
  args: { trackId: v.string(), blurb: v.string(), week: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog.curate");
    const admin = await requireUser(ctx);
    const week = args.week ?? weekOf(Date.now());
    if (!isWeekKey(week)) throw new Error("The week must be a Monday, as YYYY-MM-DD.");
    const blurb = cleanText(args.blurb, BLURB_MAX);
    if (blurb.length < 10) throw new Error("Write a short blurb — it's what listeners read.");
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(args.trackId, 120)))
      .unique();
    if (!track || track.hidden) throw new Error("Pick a published song.");
    if (!track.ownerUserId) throw new Error("The indie hook is for artists' own uploads, not chart songs.");
    const existing = await pickFor(ctx, week);
    const row = { trackId: track.trackId, week, blurb, createdAt: Date.now(), createdBy: admin.id };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("featuredHooks", row);
    // tell the artist (again only if the song changed)
    let emailed = false;
    if (!existing || existing.trackId !== track.trackId) {
      const creator = await ctx.db
        .query("creators")
        .withIndex("by_userId", (q) => q.eq("userId", track.ownerUserId!))
        .unique();
      const email = creator?.email || (await getProfile(ctx, track.ownerUserId))?.email;
      if (email) {
        const mail = featuredEmail({ song: track.title, week, blurb, shareUrl: SHARE_URL });
        await ctx.scheduler.runAfter(0, internal.email.send, { to: email, subject: mail.subject, html: mail.html });
        emailed = true;
      }
    }
    return { week, emailed };
  },
});

export const removePick = mutation({
  args: { week: v.string() },
  handler: async (ctx, { week }) => {
    await requirePermission(ctx, "catalog.curate");
    const pick = await pickFor(ctx, week);
    if (pick) await ctx.db.delete(pick._id);
  },
});
