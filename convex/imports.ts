import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MIN_CONFIDENCE,
  searchDeezer,
  searchItunes,
  type Match,
} from "./matching";
import {
  cleanText,
  cleanTrack,
  enforceRateLimit,
  ensureActiveProfile,
  getProfile,
  hasPermission,
  requireUser,
} from "./security";

/**
 * Playlist import without an API relationship.
 *
 * Spotify caps a new app at 25 named users until it clears 250K monthly actives,
 * and its preview URLs stopped being issued to new apps in November 2024. So the
 * import takes a *paste* — a CSV out of Exportify or TuneMyMusic, Music.app's own
 * export, or a plain list — and re-finds each song on two keyless catalogues
 * (iTunes Search and Deezer) to get artwork and a 30-second preview.
 *
 * Everything lands hidden, with one hook covering the preview. The creator picks
 * what to publish, which is also where the rights question gets answered by a
 * person rather than by us.
 */

/**
 * Songs per run. Bounded by iTunes' throttle rather than by anything we want:
 * ~3s a song, and a miss costs a second lookup, so this is about four minutes
 * of matching in the worst case. Six runs an hour are allowed.
 */
const MAX_ROWS = 40;
/** A preview is a fixed window no matter how long the song is. */
const PREVIEW_MS = 30_000;
/**
 * iTunes carries the import: it answers everywhere, and brings a genre with it.
 * Its informal limit is about 20 calls a minute, so each row waits ~3s — which
 * is why a run is capped and reports progress instead of just hanging.
 *
 * Deezer is the fallback rather than the lead because it filters results by the
 * caller's region: from India it returns a non-zero total with an empty list, so
 * as a primary it would silently match nothing at all.
 */
const ITUNES_GAP_MS = 3_200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ACCENTS = ["#ff3d71", "#00e5a0", "#ffb627", "#7c5cff", "#ff6b6b", "#3ddc97"];

/** What the dashboard gets back — spelled out because the action calls into its
 *  own module, and TypeScript can't infer through that cycle. */
export type ImportReport = {
  requested: number;
  matched: number;
  added: number;
  already: number;
  unusable: string[];
  unmatched: { title: string; artist: string; why: string }[];
  uncertain: { title: string; artist: string; matched: string }[];
  throttled: boolean;
};

// ------------------------------------------------------------------ the run

/**
 * Open a run. Called straight from the dashboard, which is the one place the
 * caller's identity is unambiguously present — every check that decides whether
 * this import is allowed happens here, and the token it returns is what carries
 * that decision through the matching step.
 */
export const beginImport = mutation({
  args: {
    source: v.union(
      v.literal("spotify"),
      v.literal("apple"),
      v.literal("itunes"),
      v.literal("manual"),
    ),
    playlistName: v.string(),
    total: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    ensureActiveProfile(profile);

    const curator = hasPermission(profile, "catalog.curate");
    if (!curator) {
      const creator = await ctx.db
        .query("creators")
        .withIndex("by_userId", (q) => q.eq("userId", user.id))
        .unique();
      if (creator?.status !== "approved") {
        throw new Error("Your creator account isn't approved yet");
      }
    }
    if (args.total < 1) throw new Error("Nothing to import");
    await enforceRateLimit(ctx, `import:run:${user.id}`, 6, 60 * 60_000);

    const token = [Math.random(), Math.random(), Date.now()]
      .map((n) => n.toString(36).replace("0.", ""))
      .join("");

    const importId = await ctx.db.insert("imports", {
      userId: user.id,
      source: args.source,
      playlistName: cleanText(args.playlistName, 120) || "Untitled playlist",
      status: "matching",
      total: Math.min(args.total, MAX_ROWS),
      matched: 0,
      createdAt: new Date().toISOString(),
      token,
    });
    return { importId, token };
  },
});

/** The run this token opens, or nothing. Every write below goes through it. */
async function openRun(
  ctx: { db: { get: (id: Id<"imports">) => Promise<Doc<"imports"> | null> } },
  importId: Id<"imports">,
  token: string,
) {
  const run = await ctx.db.get(importId);
  if (!run || !run.token || run.token !== token) return null;
  if (run.status !== "matching") return null; // already settled
  return run;
}

/** Write the matched tracks, one hook each, and close the run. */
export const finishImport = internalMutation({
  args: {
    importId: v.id("imports"),
    token: v.string(),
    genre: v.optional(v.string()),
    matches: v.array(
      v.object({
        provider: v.union(v.literal("itunes"), v.literal("deezer")),
        providerId: v.string(),
        title: v.string(),
        artist: v.string(),
        album: v.string(),
        artwork: v.string(),
        previewUrl: v.string(),
        durationMs: v.number(),
        genre: v.optional(v.string()),
        confidence: v.number(),
      }),
    ),
  },
  handler: async (ctx, { importId, token, genre, matches }) => {
    const run = await openRun(ctx, importId, token);
    if (!run) throw new Error("That import is no longer open");
    // whoever opened the run — re-read rather than trusting an argument
    const profile = await getProfile(ctx, run.userId);
    const curator = hasPermission(profile, "catalog.curate");

    const fallbackGenre = cleanText(genre ?? "", 40) || "imported";
    let added = 0;
    let already = 0;
    const skipped: string[] = [];

    for (const [i, m] of matches.entries()) {
      const trackId = `imp:${m.provider}:${m.providerId}`;
      const existing = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
        .unique();
      if (existing) {
        already++;
        continue;
      }

      let clean;
      try {
        clean = cleanTrack({
          trackId,
          title: m.title,
          artist: m.artist,
          album: m.album,
          artwork: m.artwork,
          previewUrl: m.previewUrl,
          // the field means the whole song; the playable part is the preview
          durationMs: Math.max(0, Math.min(m.durationMs, 30 * 60_000)),
          genre: m.genre ? cleanText(m.genre, 40) : fallbackGenre,
          accent: ACCENTS[(added + i) % ACCENTS.length],
        });
      } catch {
        // a provider handed back something that isn't a usable https URL
        skipped.push(`${m.artist} — ${m.title}`);
        continue;
      }

      await ctx.db.insert("tracks", {
        ...clean,
        hidden: true, // nothing goes live until a person publishes it
        ownerUserId: curator ? undefined : run.userId,
        origin: "import",
      });
      await ctx.db.insert("hooks", {
        trackId,
        startMs: 0,
        durationMs: PREVIEW_MS,
        label: "preview",
        order: 0,
        active: true,
        createdBy: run.userId,
        source: curator ? "curated" : "artist",
        plays: 0,
        saves: 0,
        skips: 0,
      });
      added++;
    }

    await ctx.db.patch(importId, {
      status: "done",
      matched: added,
      note:
        `${added} added` +
        (already ? `, ${already} already in the catalogue` : "") +
        (skipped.length ? `, ${skipped.length} unusable` : ""),
      token: undefined, // spent — the run can't be written to twice
    });

    return { added, already, skipped };
  },
});

/** Live counter while the run is still matching, so the UI isn't a blank wait. */
export const progressImport = internalMutation({
  args: { importId: v.id("imports"), token: v.string(), done: v.number() },
  handler: async (ctx, { importId, token, done }) => {
    const run = await openRun(ctx, importId, token);
    if (!run) return;
    await ctx.db.patch(importId, { note: `matching ${done}/${run.total}…` });
  },
});

export const failImport = internalMutation({
  args: { importId: v.id("imports"), token: v.string(), note: v.string() },
  handler: async (ctx, { importId, token, note }) => {
    const run = await openRun(ctx, importId, token);
    if (!run) return;
    await ctx.db.patch(importId, {
      status: "failed",
      note: cleanText(note, 200),
      token: undefined,
    });
  },
});

/**
 * Match a pasted playlist against the two open catalogues and import what comes
 * back. An action, because it talks to the outside world — so it holds no
 * authority of its own: `beginImport` already decided this run is allowed, and
 * the token is the only thing that lets these results be written to it.
 */
export const importPlaylist = action({
  args: {
    importId: v.id("imports"),
    token: v.string(),
    genre: v.optional(v.string()),
    rows: v.array(
      v.object({
        title: v.string(),
        artist: v.string(),
        album: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<ImportReport> => {
    const { importId, token } = args;
    const rows = args.rows
      .map((r) => ({
        title: r.title.slice(0, 160).trim(),
        artist: r.artist.slice(0, 160).trim(),
        album: r.album?.slice(0, 160).trim(),
      }))
      .filter((r) => r.title && r.artist)
      .slice(0, MAX_ROWS);

    if (rows.length === 0) throw new Error("Nothing to import");

    try {
      const matches: Match[] = [];
      const unmatched: { title: string; artist: string; why: string }[] = [];
      const uncertain: { title: string; artist: string; matched: string }[] = [];
      let itunesOpen = true;
      let deezerBlocked = false;
      let done = 0;

      for (const [i, row] of rows.entries()) {
        let match: Match | null = null;

        if (itunesOpen) {
          const found = await searchItunes(row);
          if (found === "throttled") itunesOpen = false;
          else if (found && found.confidence >= MIN_CONFIDENCE) match = found;
          // the throttle is per-minute, so pace it — but not after the last row
          if (itunesOpen && i < rows.length - 1) await sleep(ITUNES_GAP_MS);
        }

        // Second opinion, and the only source left once iTunes cuts us off.
        if (!match) {
          const found = await searchDeezer(row);
          if (found === "blocked") deezerBlocked = true;
          else if (found) match = found;
        }

        done++;
        // patch the run row every few songs so the dashboard can show progress
        if (done % 5 === 0) {
          await ctx.runMutation(internal.imports.progressImport, {
            importId,
            token,
            done,
          });
        }

        if (!match) {
          unmatched.push({
            ...row,
            why: !itunesOpen
              ? "iTunes throttled us, and Deezer had nothing"
              : deezerBlocked
                ? "not on iTunes, and Deezer won't answer from here"
                : "no catalogue match",
          });
          continue;
        }
        if (match.confidence < 0.72) {
          uncertain.push({
            ...row,
            matched: `${match.artist} — ${match.title}`,
          });
        }
        matches.push(match);
      }

      const saved: { added: number; already: number; skipped: string[] } =
        await ctx.runMutation(internal.imports.finishImport, {
          importId,
          token,
          genre: args.genre,
          matches,
        });

      return {
        requested: rows.length,
        matched: matches.length,
        added: saved.added,
        already: saved.already,
        unusable: saved.skipped,
        unmatched,
        uncertain,
        throttled: !itunesOpen,
      };
    } catch (error) {
      await ctx.runMutation(internal.imports.failImport, {
        importId,
        token,
        note: error instanceof Error ? error.message : "import failed",
      });
      throw error;
    }
  },
});

/** Past runs, newest first — the audit trail for what got pulled in. */
export const myImports = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("imports")
      .withIndex("by_userId", (q) => q.eq("userId", user.id))
      .collect();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
  },
});
