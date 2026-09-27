import { query } from "./_generated/server";
import { getProfile, requireUser } from "./security";
import { computeRecap, RECAP_DAYS, RECAP_MIN_CARDS, type RecapSwipe } from "./recapRules";
import { moodsOf, type MoodId } from "../src/data/mood";

/**
 * "Your week in hooks" for the signed-in listener — and only for them: it is
 * built from their own swipes, keyed by their own user id, and there is no way
 * to ask for anyone else's. Everything is read through the swipes by_userId
 * index (which ends in _creationTime), so it costs one listener's week, never
 * a table scan.
 */
export const week = query({
  args: {},
  handler: async (ctx) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch {
      return null;
    }
    const profile = await getProfile(ctx, user.id);
    if (!profile) return null;

    const until = Date.now();
    const since = until - RECAP_DAYS * 86_400_000;
    const weekRows = await ctx.db
      .query("swipes")
      .withIndex("by_userId", (q) => q.eq("userId", user.id).gte("_creationTime", since))
      .collect();
    if (weekRows.length < RECAP_MIN_CARDS) {
      return { ready: false as const, cards: weekRows.length, minCards: RECAP_MIN_CARDS };
    }

    // the most recent earlier swipes, enough to tell "new to you" from "again"
    const earlier = await ctx.db
      .query("swipes")
      .withIndex("by_userId", (q) => q.eq("userId", user.id).lt("_creationTime", since))
      .order("desc")
      .take(3000);
    const savedBefore = new Set(
      earlier.filter((s) => s.action === "save").map((s) => s.artist.trim().toLowerCase()),
    );

    const recap = computeRecap(weekRows as RecapSwipe[], savedBefore);

    // top moods, from what they saved, read with the same mood model the apps use
    const moodCounts = new Map<MoodId, number>();
    for (const trackId of recap.savedTrackIds.slice(0, 60)) {
      const t = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      if (!t) continue;
      const [first] = moodsOf(t);
      if (first) moodCounts.set(first, (moodCounts.get(first) ?? 0) + 1);
    }
    const topMoods = [...moodCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([m]) => m);

    return {
      ready: true as const,
      since,
      until,
      firstName: (profile.name ?? "").trim().split(/\s+/)[0] || null,
      cards: recap.cards,
      saves: recap.saves,
      skips: recap.skips,
      more: recap.more,
      nevers: recap.nevers,
      saveRate: recap.saveRate,
      newArtists: recap.newArtists,
      topArtists: recap.topArtists,
      topGenres: recap.topGenres,
      topMoods,
    };
  },
});
