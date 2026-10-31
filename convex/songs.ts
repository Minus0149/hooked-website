import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { cleanText, type TrackInput } from "./security";
import type { BakedTrack } from "./shareRules";
import catalogJson from "../src/data/catalog.json";

/**
 * A song's details as the server knows them, from its id alone.
 *
 * recordSwipe, addToPlaylist and shareToFollowers used to store whatever
 * title, artist, artwork and preview the client sent with the id. A script
 * could save "any title" over a real song's id, or post a feed card with
 * someone else's artwork and a preview link to anywhere, and followers' and
 * playlist members' devices loaded it. Now the client's copy is ignored: the
 * id is looked up in the tracks table (catalogue, imports, and own:/creator
 * uploads alike), then in the bundled first deck, and an id that is in
 * neither is refused. The argument shape is unchanged so older app builds,
 * which still send the whole object, keep working.
 */

const BAKED = new Map((catalogJson as BakedTrack[]).map((t) => [t.id, t]));
const DEFAULT_ACCENT = "#ff3d71";

/**
 * `withheld`: hidden by a person (an admin, a copyright takedown, or a creator
 * who hasn't published). The daily curation pass also hides songs (filler,
 * stale, covers), but those are still real songs people saved, so they stay
 * shareable.
 */
export type ResolvedSong = { track: TrackInput; withheld: boolean };

export async function resolveSong(ctx: QueryCtx | MutationCtx, rawTrackId: string): Promise<ResolvedSong | null> {
  const trackId = cleanText(rawTrackId, 120);
  if (!trackId) return null;
  const row = await ctx.db
    .query("tracks")
    .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
    .first();
  if (row) {
    // a creator upload with no preview plays from its own stored audio
    const previewUrl = row.previewUrl || (row.audioStorageId ? ((await ctx.storage.getUrl(row.audioStorageId)) ?? "") : "");
    return {
      withheld: row.hidden === true && row.hiddenBy !== "curation",
      track: {
        trackId: row.trackId,
        title: row.title,
        artist: row.artist,
        album: row.album,
        artwork: row.artwork,
        previewUrl,
        durationMs: row.durationMs,
        genre: row.genre,
        accent: row.accent,
      },
    };
  }
  const baked = BAKED.get(trackId);
  if (!baked) return null;
  return {
    withheld: false,
    track: {
      trackId: baked.id,
      title: baked.title,
      artist: baked.artist,
      album: baked.album ?? "",
      artwork: baked.artwork,
      previewUrl: baked.previewUrl,
      durationMs: baked.durationMs ?? 0,
      genre: baked.genre ?? "",
      accent: baked.accent ?? DEFAULT_ACCENT,
    },
  };
}

/**
 * The song for a write, or a refusal. `allowHidden` is for the swipe log: a
 * card dealt before a song was withheld can still be answered; sharing it or
 * adding it to a playlist can't.
 */
export async function requireSong(
  ctx: MutationCtx,
  rawTrackId: string,
  { allowHidden = false }: { allowHidden?: boolean } = {},
): Promise<TrackInput> {
  const found = await resolveSong(ctx, rawTrackId);
  if (!found || (found.withheld && !allowHidden)) throw new ConvexError("That song isn't in the catalogue");
  return found.track;
}

/** Room ids, deduped and bounded already: keep only songs that exist and are visible. */
export async function knownSongIds(ctx: MutationCtx, ids: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const found = await resolveSong(ctx, id);
    if (found && !found.withheld) out.push(found.track.trackId);
  }
  return out;
}
