import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { planWindows } from "./hooks";
import { cleanText, cleanTrack, requirePermission } from "./security";

/**
 * Keeping the deck's catalogue alive.
 *
 * Everything in `tracks` got there by somebody running a script:
 * `build-catalog.mjs` on a laptop with ffmpeg, or a browser import. Which
 * means the catalogue is frozen at whenever that last happened, and a music
 * discovery app whose newest song is four months old is not discovering
 * anything. This is the same source as the seed — Apple's public chart feeds —
 * on a schedule, from the server, with nobody's laptop involved.
 *
 * The shape it takes is a *rolling* refresh, and that is the whole design
 * decision. There are a hundred feeds (ten storefronts, ten genres) and
 * looking up what they return is a few hundred HTTP calls; doing that in one
 * job means a long action that fails whole, retries whole, and hammers Apple
 * on a timer. Instead each run takes the next handful of feeds and stops. Ten
 * runs cover the lot, a failed run costs a tenth of a cycle, and the load is
 * a trickle rather than a spike.
 */

// Charts are per storefront, so spreading the countries is what keeps the deck
// from being one market's top 40. India and the Gulf are deliberate — that is
// who this is built for first. Mirrors scripts/build-catalog.mjs.
const COUNTRIES = ["in", "us", "gb", "ae", "sa", "ca", "au", "ng", "kr", "br"];

// 0 is the all-genres feed; the rest stop the charts collapsing into pop.
const GENRES = [0, 14, 21, 18, 17, 20, 15, 6, 7, 19];

const ACCENTS = [
  "#ff3d71", "#00e5a0", "#ffb627", "#7c5cff",
  "#ff6b6b", "#3ddc97", "#4dabf7", "#f783ac",
];

const PREVIEW_MS = 30_000;

const CURSOR_KEY = "charts:cursor";
const REPORT_KEY = "charts:lastRun";

export type Feed = { country: string; url: string };

/** Every feed, in a fixed order, so a cursor into it means something. */
export function allFeeds(): Feed[] {
  const feeds: { country: string; url: string }[] = [];
  for (const country of COUNTRIES) {
    for (const genre of GENRES) {
      const g = genre === 0 ? "" : `genre=${genre}/`;
      feeds.push({
        country,
        url: `https://itunes.apple.com/${country}/rss/topsongs/limit=100/${g}json`,
      });
    }
  }
  return feeds;
}

/**
 * The next `count` feeds from `start`, wrapping.
 *
 * Separated out because the failure it prevents is invisible: a slice that
 * quietly always returns the same feeds looks exactly like one that rotates,
 * and the catalogue would simply stop growing past the first ten storefront
 * pages while the job reported success every night.
 */
export function feedSlice<T>(feeds: T[], start: number, count: number): T[] {
  if (feeds.length === 0 || count <= 0) return [];
  const n = Math.min(count, feeds.length);
  const from = ((start % feeds.length) + feeds.length) % feeds.length;
  return Array.from({ length: n }, (_, i) => feeds[(from + i) % feeds.length]);
}

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/**
 * Nine of the hundred feeds never answer — a genre a storefront doesn't carry.
 * Without a deadline one of them holds the run open until the action times out.
 */
async function get(url: string, ms = 15_000): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(ms) });
  } catch {
    return null;
  }
}

type ChartEntry = { id?: { attributes?: Record<string, string> } };
type ItunesTrack = {
  wrapperType?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
};

export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped?: string; feeds?: number; found?: number; added?: number }> => {
    // An action has no database handle, so the config comes through the same
    // public query the clients read.
    const runtime = await ctx.runQuery(api.runtime.get, {});
    const perRun = runtime.chartFeedsPerRun;
    // The off switch. Zero here stops the job without a deploy — the same
    // shape as recsStrength, and for the same reason: anything that reaches
    // outside on a timer should be stoppable from the dashboard.
    if (perRun === 0) return { skipped: "chartFeedsPerRun is 0" };

    const feeds = allFeeds();
    const start = await ctx.runQuery(internal.charts.cursor, {});
    const slice = feedSlice(feeds, start, perRun);

    // Which storefronts a song charts in is the only language signal these
    // feeds carry. Apple's genre taxonomy is mostly Western — an entire
    // Bollywood chart comes back as "worldwide" — so charting in `in` is what
    // tells us a track is likely Hindi, and `sa`/`ae` Arabic.
    const seen = new Map<string, Set<string>>();
    let answered = 0;
    for (const feed of slice) {
      const res = await get(feed.url);
      if (!res || !res.ok) continue;
      let json: { feed?: { entry?: ChartEntry[] } };
      try {
        json = (await res.json()) as typeof json;
      } catch {
        continue;
      }
      const entries = json?.feed?.entry;
      if (!Array.isArray(entries)) continue;
      answered++;
      for (const e of entries) {
        const id = e?.id?.attributes?.["im:id"];
        if (!id) continue;
        const markets = seen.get(id) ?? new Set<string>();
        markets.add(feed.country);
        seen.set(id, markets);
      }
    }

    await ctx.runMutation(internal.charts.setCursor, {
      next: (start + slice.length) % feeds.length,
    });

    if (seen.size === 0) {
      await ctx.runMutation(internal.charts.report, {
        value: { at: new Date().toISOString(), feeds: slice.length, answered, found: 0, added: 0 },
      });
      return { feeds: slice.length, found: 0, added: 0 };
    }

    // Ask the database what it already has before paying for the lookup. Most
    // of a chart is last week's chart, so this is the difference between a few
    // hundred detail rows a night and a few thousand.
    const ids = [...seen.keys()];
    const fresh = await ctx.runQuery(internal.charts.unknownIds, { ids });
    if (fresh.length === 0) {
      await ctx.runMutation(internal.charts.report, {
        value: {
          at: new Date().toISOString(),
          feeds: slice.length,
          answered,
          found: ids.length,
          added: 0,
        },
      });
      return { feeds: slice.length, found: ids.length, added: 0 };
    }

    // The lookup endpoint takes 100 ids at a time and is generous, not free.
    const details: ItunesTrack[] = [];
    for (let i = 0; i < fresh.length; i += 100) {
      const batch = fresh.slice(i, i + 100);
      const res = await get(
        `https://itunes.apple.com/lookup?id=${batch.join(",")}&entity=song`,
        25_000,
      );
      if (!res || !res.ok) continue;
      try {
        const json = (await res.json()) as { results?: ItunesTrack[] };
        for (const r of json.results ?? []) {
          if (r.wrapperType === "track" && r.previewUrl && r.artworkUrl100) details.push(r);
        }
      } catch {
        /* a malformed batch is a lost batch, not a lost run */
      }
      if (i + 100 < fresh.length) await new Promise((r) => setTimeout(r, 1_200));
    }

    const rows = details.map((r) => {
      const trackId = String(r.trackId);
      return {
        trackId,
        title: r.trackName ?? "",
        artist: r.artistName ?? "",
        album: r.collectionName ?? "",
        artwork: (r.artworkUrl100 ?? "").replace(/100x100bb/, "600x600bb"),
        previewUrl: r.previewUrl ?? "",
        durationMs: r.trackTimeMillis ?? 0,
        genre: (r.primaryGenreName ?? "").toLowerCase(),
        markets: [...(seen.get(trackId) ?? [])],
      };
    });

    // A track is four documents (itself plus three hook windows), so the
    // writes are chunked well inside one transaction's budget. A day the
    // charts turn over completely should not be the day this throws.
    const added = { added: 0, unusable: 0 };
    for (let i = 0; i < rows.length; i += 60) {
      const part = await ctx.runMutation(internal.charts.absorb, {
        tracks: rows.slice(i, i + 60),
      });
      added.added += part.added;
      added.unusable += part.unusable;
    }

    await ctx.runMutation(internal.charts.report, {
      value: {
        at: new Date().toISOString(),
        feeds: slice.length,
        answered,
        found: ids.length,
        added: added.added,
        unusable: added.unusable,
      },
    });
    return { feeds: slice.length, found: ids.length, added: added.added };
  },
});

// ------------------------------------------------------------------ storage

export const cursor = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();
    const n = row?.value?.next;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  },
});

export const setCursor = internalMutation({
  args: { next: v.number() },
  handler: async (ctx, { next }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: { next } });
    else await ctx.db.insert("appSettings", { key: CURSOR_KEY, value: { next } });
  },
});

export const report = internalMutation({
  args: { value: v.any() },
  handler: async (ctx, { value }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", REPORT_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("appSettings", { key: REPORT_KEY, value });
  },
});

/** Which of these the catalogue has never seen. Indexed, so it stays cheap. */
export const unknownIds = internalQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }): Promise<string[]> => {
    const out: string[] = [];
    for (const id of ids.slice(0, 1_000)) {
      const existing = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", id))
        .unique();
      if (!existing) out.push(id);
    }
    return out;
  },
});

export const absorb = internalMutation({
  args: {
    tracks: v.array(
      v.object({
        trackId: v.string(),
        title: v.string(),
        artist: v.string(),
        album: v.string(),
        artwork: v.string(),
        previewUrl: v.string(),
        durationMs: v.number(),
        genre: v.string(),
        markets: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { tracks }): Promise<{ added: number; unusable: number }> => {
    let added = 0;
    let unusable = 0;

    for (const t of tracks) {
      // re-check inside the transaction: the lookup happened outside it
      const existing = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", t.trackId))
        .unique();
      if (existing) continue;

      let clean;
      try {
        clean = cleanTrack({
          trackId: t.trackId,
          title: t.title,
          artist: t.artist,
          album: t.album,
          artwork: t.artwork,
          previewUrl: t.previewUrl,
          durationMs: Math.max(0, Math.min(t.durationMs, 30 * 60_000)),
          genre: cleanText(t.genre, 40) || "pop",
          accent: ACCENTS[hash(t.trackId) % ACCENTS.length],
        });
      } catch {
        // a chart row without a usable https artwork or preview URL
        unusable++;
        continue;
      }

      // Visible immediately, unlike a playlist import. An import is a list a
      // *listener* handed us and it waits for a curator; this is the same
      // public chart feed that produced the seeded catalogue, fetched by the
      // same code. Hiding it by default would mean the refresh does nothing
      // until somebody notices it ran, which is the problem it was built for.
      await ctx.db.insert("tracks", {
        ...clean,
        markets: t.markets.slice(0, 12),
        origin: "curated",
      });

      // Three windows, not one block. Nothing has measured this song's audio
      // yet — scripts/analyze-hooks.mjs does that from a machine with ffmpeg —
      // and until it has, evenly spaced windows give a listener three chances
      // to catch the song instead of one. The deck reorders them by save rate
      // once they have plays.
      for (const [order, w] of planWindows(PREVIEW_MS).entries()) {
        await ctx.db.insert("hooks", {
          trackId: clean.trackId,
          startMs: w.startMs,
          durationMs: w.durationMs,
          order,
          active: true,
          createdBy: "system:charts",
          source: "curated",
        });
      }
      added++;
    }

    return { added, unusable };
  },
});

/** Run it now, from the dashboard, without waiting for the schedule. */
export const refreshNow = mutation({
  args: {},
  handler: async (ctx): Promise<{ started: true }> => {
    await requirePermission(ctx, "catalog.curate");
    await ctx.scheduler.runAfter(0, internal.charts.refresh, {});
    return { started: true };
  },
});
