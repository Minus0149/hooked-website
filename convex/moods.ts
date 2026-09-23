import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { enforceRateLimit, requireGatedUser, requirePermission } from "./security";
import { runtimeFor } from "./runtime";

/**
 * What a song feels like, according to the people who heard it.
 *
 * Genre is a shelf in a shop; mood is an experience. Apple files a wedding
 * banger and a funeral under the same word, and no amount of reading that word
 * more carefully will separate them. The only cheap source of truth is the
 * listeners, and they are already holding the card.
 *
 * So the long-press that steers the deck also casts a vote, and the votes
 * become a catalogue-wide fact that every listener benefits from — the same
 * trade the swipe log makes in recommend.ts, with the same two guards:
 *
 *   - A vote is changeable, not cumulative. One row per listener per track, so
 *     pressing four faces in a row is one opinion, not four.
 *   - Nothing is published on one person's say-so. Below the floor a tag stays
 *     on the server. On a catalogue this size a count of one is not an
 *     aggregate; it is a person, and it is legible as one.
 *
 * The mood ids are duplicated from src/data/mood.ts rather than imported — the
 * Convex bundle and the client bundle are built separately and nothing crosses
 * that line. A test pins the two lists together so they cannot drift.
 */

export const MOOD_IDS = ["hyped", "party", "sunny", "chill", "tender", "sleepy"] as const;
export type MoodId = (typeof MOOD_IDS)[number];

export const isMood = (value: string): value is MoodId =>
  (MOOD_IDS as readonly string[]).includes(value);

export type Counts = { mood: string; n: number }[];

/**
 * Move one listener's vote from whichever face they pressed before to the one
 * they just pressed.
 *
 * Pure, because the arithmetic is where this goes wrong: a decrement that
 * misses leaves a permanent phantom vote, and nothing downstream can tell a
 * phantom from a person. Counts never go below zero and empty moods are
 * dropped, so a track everyone un-votes ends up genuinely untagged rather than
 * tagged with a row of noughts.
 */
export function applyVote(counts: Counts, previous: string | null, next: string): Counts {
  const tally = new Map(counts.map((c) => [c.mood, c.n]));
  if (previous && previous !== next) {
    const was = (tally.get(previous) ?? 0) - 1;
    if (was > 0) tally.set(previous, was);
    else tally.delete(previous);
  }
  if (previous !== next) tally.set(next, (tally.get(next) ?? 0) + 1);
  return [...tally]
    .filter(([mood, n]) => n > 0 && isMood(mood))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([mood, n]) => ({ mood, n }));
}

/** Only what enough separate listeners agreed on leaves the server. */
export function publishable(counts: Counts, floor: number): Counts {
  return counts.filter((c) => c.n >= Math.max(1, floor));
}

/**
 * Cast or change this listener's vote on what a track feels like.
 *
 * Deliberately returns nothing. The gesture's visible result is the deck
 * re-ranking, which happens on the client the instant the face is pressed —
 * waiting on a round trip to show it would make a 40ms interaction feel like a
 * network operation.
 */
export const vote = mutation({
  args: { trackId: v.string(), mood: v.string() },
  handler: async (ctx, { trackId, mood }) => {
    const { user } = await requireGatedUser(ctx);
    if (!isMood(mood)) throw new Error("Unknown mood");
    await enforceRateLimit(ctx, `mood:${user.id}`, 240, 60_000);

    const userId = String(user.id);
    const existing = await ctx.db
      .query("moodVotes")
      .withIndex("by_user_track", (q) => q.eq("userId", userId).eq("trackId", trackId))
      .unique();
    if (existing?.mood === mood) return;

    const at = new Date().toISOString();
    if (existing) await ctx.db.patch(existing._id, { mood, at });
    else await ctx.db.insert("moodVotes", { userId, trackId, mood, at });

    const row = await ctx.db
      .query("trackMoods")
      .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
      .unique();
    const counts = applyVote(row?.counts ?? [], existing?.mood ?? null, mood);
    if (row) await ctx.db.patch(row._id, { counts, updatedAt: at });
    else await ctx.db.insert("trackMoods", { trackId, counts, updatedAt: at });
  },
});

/**
 * Every published mood tag in the catalogue.
 *
 * Fetched once per session, not subscribed to: a vote from a stranger three
 * time zones away is not a reason to re-rank the card under someone's thumb.
 * It is small by construction — one row per track anyone has ever labelled,
 * minus everything below the floor — and it is the same answer for everybody,
 * so it caches.
 */
export const crowd = query({
  args: {},
  handler: async (ctx) => {
    const runtime = await runtimeFor(ctx);
    const rows = await ctx.db.query("trackMoods").collect();
    return rows
      .map((row) => ({
        trackId: row.trackId,
        counts: publishable(row.counts, runtime.moodMinVotes),
      }))
      .filter((row) => row.counts.length > 0);
  },
});

/**
 * What this listener personally said about the tracks they have labelled.
 *
 * Their own votes come back below the floor — the floor protects people from
 * each other, not from themselves — so the face they picked stays lit when
 * they see the song again.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireGatedUser(ctx);
    const rows = await ctx.db
      .query("moodVotes")
      .withIndex("by_user_track", (q) => q.eq("userId", String(user.id)))
      .take(500);
    return rows.map((r) => ({ trackId: r.trackId, mood: r.mood }));
  },
});

/* --------------------------------------------------------------- dashboard */

export type MoodSummary = {
  floor: number;
  votes: number;
  voters: number;
  /** tracks anyone has labelled */
  tagged: number;
  /** tracks with at least one mood above the floor — what listeners see */
  published: number;
  byMood: { mood: MoodId; votes: number; tracks: number }[];
  energy: { analysed: number; total: number; buckets: number[] };
  top: {
    mood: MoodId;
    tracks: { trackId: string; title: string; artist: string; artwork: string; n: number }[];
  }[];
};

type TrackLite = { trackId: string; title: string; artist: string; artwork: string; energy?: number; hidden?: boolean };

/**
 * The whole mood picture, from the raw rows. Pure so it can be tested without
 * a backend — the dashboard is the one place a counting mistake would be read
 * as a fact about listeners.
 */
export function summariseMoods(
  votes: { userId: string; trackId: string; mood: string }[],
  tallies: { trackId: string; counts: Counts }[],
  tracks: TrackLite[],
  floor: number,
): MoodSummary {
  const live = tracks.filter((t) => t.hidden !== true);
  const byId = new Map(live.map((t) => [t.trackId, t]));

  const byMood = MOOD_IDS.map((mood) => ({
    mood,
    votes: votes.filter((v) => v.mood === mood).length,
    tracks: tallies.filter((t) => publishable(t.counts, floor).some((c) => c.mood === mood)).length,
  }));

  // five equal bands of measured energy, quiet to loud
  const buckets = [0, 0, 0, 0, 0];
  let analysed = 0;
  for (const t of live) {
    if (typeof t.energy !== "number") continue;
    analysed++;
    buckets[Math.min(4, Math.max(0, Math.floor(t.energy * 5)))]++;
  }

  const top = MOOD_IDS.map((mood) => ({
    mood,
    tracks: tallies
      .map((t) => ({ t, n: publishable(t.counts, floor).find((c) => c.mood === mood)?.n ?? 0 }))
      .filter((x) => x.n > 0 && byId.has(x.t.trackId))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map(({ t, n }) => {
        const track = byId.get(t.trackId)!;
        return { trackId: t.trackId, title: track.title, artist: track.artist, artwork: track.artwork, n };
      }),
  }));

  return {
    floor: Math.max(1, floor),
    votes: votes.length,
    voters: new Set(votes.map((v) => v.userId)).size,
    tagged: tallies.filter((t) => t.counts.length > 0).length,
    published: tallies.filter((t) => publishable(t.counts, floor).length > 0).length,
    byMood,
    energy: { analysed, total: live.length, buckets },
    top,
  };
}

/**
 * What the dashboard shows about moods. Staff only: the per-track counts here
 * include what is still below the floor, which is exactly the information the
 * floor exists to keep from ordinary clients.
 */
export const adminSummary = query({
  args: {},
  handler: async (ctx): Promise<MoodSummary | null> => {
    try {
      await requirePermission(ctx, "stats.view");
    } catch {
      return null;
    }
    const runtime = await runtimeFor(ctx);
    // bounded: the most recent votes are the ones that describe the catalogue now
    const votes = await ctx.db.query("moodVotes").order("desc").take(20_000);
    const tallies = await ctx.db.query("trackMoods").collect();
    const tracks = await ctx.db.query("tracks").collect();
    return summariseMoods(
      votes.map((v) => ({ userId: v.userId, trackId: v.trackId, mood: v.mood })),
      tallies.map((t) => ({ trackId: t.trackId, counts: t.counts })),
      tracks.map((t) => ({
        trackId: t.trackId,
        title: t.title,
        artist: t.artist,
        artwork: t.artwork,
        energy: t.energy,
        hidden: t.hidden,
      })),
      runtime.moodMinVotes,
    );
  },
});
