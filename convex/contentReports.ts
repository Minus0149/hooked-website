import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { cleanText, enforceRateLimit, requirePermission } from "./security";
import { renderEmail } from "./emailTemplate";

/**
 * "Report this song" — Google Play's user-generated-content policy asks for an
 * in-app way to report content (creator uploads are UGC). Anyone can report,
 * guests included; reports land in the admin's Song reports tab, and copyright
 * reports also go to copyright@hookedcue.com.
 *
 * The ids mirror src/lib/contentReport.ts (tests/content-report.test.ts keeps
 * them in step).
 */
export const REPORT_REASON_IDS = ["copyright", "offensive", "sexual", "spam", "other"] as const;
export type ReportReasonId = (typeof REPORT_REASON_IDS)[number];
const reasonValidator = v.union(
  v.literal("copyright"),
  v.literal("offensive"),
  v.literal("sexual"),
  v.literal("spam"),
  v.literal("other"),
);

export const COPYRIGHT_INBOX = "copyright@hookedcue.com";

/**
 * Who is reporting, as a stable key for dedupe and rate limits, or null when
 * there is nobody to hold to a limit (no account and no device key).
 */
export function reporterKey(userId: string | null, anonKey: string | null | undefined): string | null {
  if (userId) return `user:${userId}`;
  const k = (anonKey ?? "").trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(k) ? `anon:${k}` : null;
}

/** Per reporter, per hour: an account gets a little more room than a device key. */
export function reportLimit(reporter: string): number {
  return reporter.startsWith("user:") ? 10 : 5;
}

export const submit = mutation({
  args: {
    trackId: v.string(),
    title: v.string(),
    artist: v.string(),
    reason: reasonValidator,
    note: v.optional(v.string()),
    anonKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    const reporter = reporterKey(user ? String(user._id) : null, args.anonKey);
    if (!reporter) throw new Error("Couldn't send that report. Try again?");
    await enforceRateLimit(ctx, `report:${reporter}`, reportLimit(reporter), 60 * 60_000);
    await enforceRateLimit(ctx, "report:global", 300, 60 * 60_000);

    const trackId = cleanText(args.trackId, 120);
    // one open report per person per track: a second tap just says thanks again
    const earlier = await ctx.db
      .query("contentReports")
      .withIndex("by_reporter_track", (q) => q.eq("reporter", reporter).eq("trackId", trackId))
      .collect();
    if (earlier.some((r) => r.status === "open")) return { ok: true as const, duplicate: true };

    // the stored title/artist come from the catalogue when the track is there
    // (the deck can also show the bundled starter list, which isn't)
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
      .unique();
    const title = track?.title ?? cleanText(args.title, 200);
    const artist = track?.artist ?? cleanText(args.artist, 200);
    const note = (args.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

    await ctx.db.insert("contentReports", {
      trackId,
      title,
      artist,
      reason: args.reason,
      note: note || undefined,
      reporter,
      status: "open",
      createdAt: Date.now(),
    });

    if (args.reason === "copyright") {
      const site = process.env.SITE_URL ?? "https://app.hookedcue.com";
      const who = user ? `a listener with an account (${user.email})` : "a listener without an account";
      await ctx.scheduler.runAfter(0, internal.email.send, {
        to: COPYRIGHT_INBOX,
        subject: `copyright report: ${title} — ${artist}`,
        html: renderEmail({
          preheader: "A listener reported a song for copyright.",
          heading: "Copyright report",
          paragraphs: [
            `**${title}** — ${artist} (track ${trackId}) was reported for copyright by ${who}.`,
            note ? `Their note: “${note}”` : "They left no note.",
            "Hide it from the deck or dismiss the report in the admin's Song reports tab.",
          ],
          button: { label: "Open song reports", url: `${site}/admin` },
        }),
      });
    }
    return { ok: true as const, duplicate: false };
  },
});

export type ReportGroup = {
  trackId: string;
  title: string;
  artist: string;
  artwork: string | null;
  hidden: boolean;
  count: number;
  reasons: Partial<Record<ReportReasonId, number>>;
  notes: string[];
  lastAt: number;
};

/** Open reports, one row per track, the most-reported first. */
export const listOpen = query({
  args: {},
  handler: async (ctx): Promise<ReportGroup[] | null> => {
    try {
      await requirePermission(ctx, "catalog.curate");
    } catch {
      return null;
    }
    const open = await ctx.db
      .query("contentReports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(500);
    const groups = new Map<string, ReportGroup>();
    for (const r of open) {
      const g =
        groups.get(r.trackId) ??
        ({ trackId: r.trackId, title: r.title, artist: r.artist, artwork: null, hidden: false, count: 0, reasons: {}, notes: [], lastAt: 0 } as ReportGroup);
      g.count++;
      g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
      if (r.note && g.notes.length < 3) g.notes.push(r.note);
      g.lastAt = Math.max(g.lastAt, r.createdAt);
      groups.set(r.trackId, g);
    }
    for (const g of groups.values()) {
      const t = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", g.trackId))
        .unique();
      g.artwork = t?.artwork ?? null;
      g.hidden = t?.hidden === true;
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  },
});

/** Close every open report on a track: dismiss them, or hide the track too. */
export const resolve = mutation({
  args: { trackId: v.string(), action: v.union(v.literal("dismiss"), v.literal("hide")) },
  handler: async (ctx, { trackId, action }) => {
    const { user, profile } = await requirePermission(ctx, "catalog.curate");
    const by = profile?.email ?? user.email;
    if (action === "hide") {
      const t = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      if (t && !t.hidden) await ctx.db.patch(t._id, { hidden: true });
    }
    const open = await ctx.db
      .query("contentReports")
      .withIndex("by_track_status", (q) => q.eq("trackId", trackId).eq("status", "open"))
      .collect();
    const now = Date.now();
    for (const r of open) {
      await ctx.db.patch(r._id, {
        status: action === "hide" ? "actioned" : "dismissed",
        resolvedAt: now,
        resolvedBy: by,
      });
    }
    return { closed: open.length };
  },
});
