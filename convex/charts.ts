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
import { touchCatalog } from "./catalog";
import { FEEDS, fillerReason, langOf, type Feed } from "./catalogRules";

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
 * decision. There are 32 feeds (convex/catalogRules.ts FEEDS: India's own
 * genre charts first, then the Western headline charts) and looking up what
 * they return is a few dozen HTTP calls; doing that in one job means a long
 * action that fails whole, retries whole, and hammers Apple on a timer.
 * Instead each run takes the next handful of feeds and stops, a failed run
 * costs a fraction of a cycle, and the load is a trickle rather than a spike.
 *
 * A song seen again is not skipped any more: it gets its chart clock
 * (`chartedAt`, and `headlineAt` for a main chart) and any new storefront, so
 * the daily curation pass (convex/curation.ts) can tell a song that is still
 * charting from one that left every chart two months ago.
 */

const ACCENTS = [
  "#ff3d71", "#00e5a0", "#ffb627", "#7c5cff",
  "#ff6b6b", "#3ddc97", "#4dabf7", "#f783ac",
];

const PREVIEW_MS = 30_000;

const CURSOR_KEY = "charts:cursor";
const REPORT_KEY = "charts:lastRun";

export type { Feed };

/** Every feed, in a fixed order, so a cursor into it means something. */
export function allFeeds(): Feed[] {
  return FEEDS;
}

/** The track ids a feed returned, whichever of Apple's two formats it is in. */
export function feedIds(feed: Pick<Feed, "v2">, json: unknown): string[] | null {
  const j = json as {
    feed?: { entry?: ChartEntry[] | ChartEntry; results?: { id?: string }[] };
  };
  if (feed.v2) {
    const results = j?.feed?.results;
    if (!Array.isArray(results)) return null;
    return results.map((r) => String(r?.id ?? "")).filter((id) => /^\d+$/.test(id));
  }
  if (!j?.feed || typeof j.feed !== "object") return null;
  const raw = j.feed.entry;
  // a one-song chart comes back as an object, not a list; an empty one has no entry
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return entries.map((e) => e?.id?.attributes?.["im:id"] ?? "").filter((id) => /^\d+$/.test(id));
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
 * A feed that never answers (a genre a storefront stops carrying) would hold
 * the run open until the action times out without a deadline.
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
  releaseDate?: string;
};

export const refresh = internalAction({
  args: { all: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { all },
  ): Promise<{ skipped?: string; feeds?: number; found?: number; seenAgain?: number; added?: number }> => {
    // An action has no database handle, so the config comes through the same
    // public query the clients read.
    const runtime = await ctx.runQuery(api.runtime.get, {});
    const perRun = runtime.chartFeedsPerRun;
    // The off switch. Zero here stops the job without a deploy — the same
    // shape as recsStrength, and for the same reason: anything that reaches
    // outside on a timer should be stoppable from the dashboard. A full sweep
    // (`all`, started by hand) is the one exception.
    if (perRun === 0 && !all) return { skipped: "chartFeedsPerRun is 0" };

    const feeds = allFeeds();
    const start = all ? 0 : await ctx.runQuery(internal.charts.cursor, {});
    const slice = all ? feeds : feedSlice(feeds, start, perRun);

    // Which storefronts a song charts in, and whether any of them carried it
    // on its main chart. Apple files much of India's output as "worldwide",
    // so the storefront is part of how langOf places a song.
    const seen = new Map<string, { markets: Set<string>; headline: boolean }>();
    let answered = 0;
    const failed: string[] = [];
    for (const feed of slice) {
      let ids: string[] | null = null;
      // Apple's chart hosts time out or 504 now and then; one retry, then move on
      for (let attempt = 0; attempt < 2 && !ids; attempt++) {
        const res = await get(feed.url, 25_000);
        if (!res || !res.ok) continue;
        try {
          ids = feedIds(feed, await res.json());
        } catch {
          ids = null;
        }
      }
      if (!ids) {
        failed.push(feed.id);
        continue;
      }
      answered++;
      for (const id of ids) {
        const entry = seen.get(id) ?? { markets: new Set<string>(), headline: false };
        entry.markets.add(feed.country);
        entry.headline = entry.headline || feed.headline;
        seen.set(id, entry);
      }
    }

    if (!all) {
      await ctx.runMutation(internal.charts.setCursor, {
        next: (start + slice.length) % feeds.length,
      });
    }

    const now = Date.now();
    const ids = [...seen.keys()];

    // Songs already in the catalogue: restart their chart clock. Whatever it
    // doesn't know comes back to be looked up.
    let seenAgain = 0;
    const fresh: string[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const r = await ctx.runMutation(internal.charts.markSeen, {
        now,
        rows: ids.slice(i, i + 200).map((trackId) => {
          const e = seen.get(trackId)!;
          return { trackId, markets: [...e.markets], headline: e.headline };
        }),
      });
      seenAgain += r.updated;
      fresh.push(...r.unknown);
    }

    // The lookup endpoint takes 100 ids at a time and is generous, not free.
    const details: ItunesTrack[] = [];
    for (let i = 0; i < fresh.length; i += 100) {
      details.push(...(await lookup(fresh.slice(i, i + 100))));
      if (i + 100 < fresh.length) await new Promise((r) => setTimeout(r, 1_200));
    }

    const rows = details.map((r) => {
      const e = seen.get(String(r.trackId));
      return { ...rowOf(r), markets: [...(e?.markets ?? [])], headline: e?.headline ?? false };
    });

    // A track is four documents (itself plus three hook windows), so the
    // writes are chunked well inside one transaction's budget. A day the
    // charts turn over completely should not be the day this throws.
    const added = { added: 0, unusable: 0, hidden: 0 };
    for (let i = 0; i < rows.length; i += 60) {
      const part = await ctx.runMutation(internal.charts.absorb, {
        now,
        tracks: rows.slice(i, i + 60),
      });
      added.added += part.added;
      added.unusable += part.unusable;
      added.hidden += part.hidden;
    }

    await ctx.runMutation(internal.charts.report, {
      value: {
        at: new Date(now).toISOString(),
        feeds: slice.length,
        answered,
        failed,
        found: ids.length,
        seenAgain,
        added: added.added,
        hiddenOnArrival: added.hidden,
        unusable: added.unusable,
      },
    });
    return { feeds: slice.length, found: ids.length, seenAgain, added: added.added };
  },
});

/** Apple's details for up to 100 ids; anything without a preview or artwork is dropped. */
export async function lookup(ids: string[]): Promise<ItunesTrack[]> {
  const res = await get(`https://itunes.apple.com/lookup?id=${ids.join(",")}&entity=song`, 25_000);
  if (!res || !res.ok) return [];
  try {
    const json = (await res.json()) as { results?: ItunesTrack[] };
    return (json.results ?? []).filter(
      (r) => r.wrapperType === "track" && !!r.previewUrl && !!r.artworkUrl100,
    );
  } catch {
    return []; // a malformed batch is a lost batch, not a lost run
  }
}

/** A lookup result in the shape absorb takes. */
export function rowOf(r: ItunesTrack) {
  return {
    trackId: String(r.trackId),
    title: r.trackName ?? "",
    artist: r.artistName ?? "",
    album: r.collectionName ?? "",
    artwork: (r.artworkUrl100 ?? "").replace(/100x100bb/, "600x600bb"),
    previewUrl: r.previewUrl ?? "",
    durationMs: r.trackTimeMillis ?? 0,
    genre: (r.primaryGenreName ?? "").toLowerCase(),
    releaseDate: typeof r.releaseDate === "string" ? r.releaseDate.slice(0, 10) : "",
  };
}

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

/**
 * Songs a chart carried that the catalogue already has: union the storefronts
 * and restart the chart clock. Returns the ids it didn't know.
 */
export const markSeen = internalMutation({
  args: {
    now: v.number(),
    rows: v.array(v.object({ trackId: v.string(), markets: v.array(v.string()), headline: v.boolean() })),
  },
  handler: async (ctx, { now, rows }): Promise<{ updated: number; unknown: string[] }> => {
    let updated = 0;
    let visible = false;
    const unknown: string[] = [];
    for (const r of rows) {
      const t = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", r.trackId))
        .unique();
      if (!t) {
        unknown.push(r.trackId);
        continue;
      }
      const markets = [...new Set([...(t.markets ?? []), ...r.markets])].slice(0, 12);
      // Only a song never placed gets a language here. Re-placing is the daily
      // curation pass's job: it has the whole catalogue's artist hints, and a
      // placement without them would undo its work every night.
      const lang = t.lang === undefined ? langOf({ ...t, markets }) : t.lang;
      const grew = markets.length !== (t.markets?.length ?? 0);
      const moved = lang !== (t.lang ?? "");
      await ctx.db.patch(t._id, {
        chartedAt: now,
        ...(r.headline ? { headlineAt: now } : {}),
        ...(grew ? { markets } : {}),
        ...(moved ? { lang } : {}),
      });
      updated++;
      if (!t.hidden && (grew || moved)) visible = true;
    }
    if (visible) await touchCatalog(ctx);
    return { updated, unknown };
  },
});

export const absorb = internalMutation({
  args: {
    now: v.optional(v.number()),
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
        releaseDate: v.optional(v.string()),
        headline: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { tracks, now: at }): Promise<{ added: number; unusable: number; hidden: number }> => {
    const now = at ?? Date.now();
    let added = 0;
    let unusable = 0;
    let hidden = 0;

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
      //
      // Filler (a karaoke version, a sped-up edit, a devotional chart's spill)
      // arrives hidden by curation instead, the way the daily pass would hide
      // it tomorrow — and, as with that pass, an admin can un-hide it.
      const markets = t.markets.slice(0, 12);
      const filler = fillerReason(clean);
      if (filler) hidden++;
      await ctx.db.insert("tracks", {
        ...clean,
        markets,
        origin: "curated",
        lang: langOf({ ...clean, markets }),
        ...(t.releaseDate ? { releaseDate: t.releaseDate } : {}),
        chartedAt: now,
        ...(t.headline ? { headlineAt: now } : {}),
        ...(filler ? { hidden: true, hiddenBy: "curation", hiddenReason: filler } : {}),
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

    if (added > hidden) await touchCatalog(ctx);
    return { added, unusable, hidden };
  },
});

/** Run it now, from the dashboard, without waiting for the schedule. */
export const refreshNow = mutation({
  args: { all: v.optional(v.boolean()) },
  handler: async (ctx, { all }): Promise<{ started: true }> => {
    await requirePermission(ctx, "catalog.curate");
    // `all` sweeps every feed in one run instead of the next slice
    await ctx.scheduler.runAfter(0, internal.charts.refresh, { all: all === true });
    return { started: true };
  },
});
