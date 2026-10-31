import { v, ConvexError } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { trackFields } from "./schema";
import { cleanText, enforceRateLimit, getProfile, requireGatedUser } from "./security";
import { normalizeUsername } from "../src/lib/username";
import {
  BLOCK_LIST_MAX,
  ROOM_MAX_MEMBERS,
  ROOM_MAX_TRACKS,
  ROOM_PRESENCE_MS,
  canAddToPlaylist,
  canRemoveFromPlaylist,
  blockProblem,
  blockedPeople,
  canViewPlaylist,
  cleanNote,
  coerceVisibility,
  followProblem,
  isMutual,
  MUTUAL_SOURCE_KIND,
  mutualSource,
  PLAYLIST_CODE_LENGTH,
  ROOM_CODE_LENGTH,
  inviteCodeChange,
  inviteOpen,
  membersAfterSharing,
  makeCode,
  mergeFeed,
  mutualMix,
  nextRoomIndex,
  normalizeCode,
  publicName,
  roomIsOpen,
} from "./socialRules";
import { secureRandom } from "./secureRandom";
import { knownSongIds, requireSong } from "./songs";

/**
 * The social side of HookedCue: follows, songs shared to followers, shared and
 * collaborative playlists, the mutual playlist, and listening rooms.
 *
 * Every decision about who may see or change what is in socialRules.ts; this
 * file only reads and writes. Nothing here ever returns an email address: other
 * people are shown by @username and display name only.
 */

type Ctx = QueryCtx | MutationCtx;

async function viewerId(ctx: Ctx): Promise<string | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  const profile = await getProfile(ctx, String(user._id));
  return profile && !profile.suspended ? profile.userId : null;
}

async function byUsername(ctx: Ctx, username: string) {
  const handle = normalizeUsername(username);
  if (!handle) return null;
  return ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", handle))
    .unique();
}

// never the email-derived default name (socialRules.publicName)
const displayName = (p: Doc<"profiles"> | null) => publicName(p);
const person = (p: Doc<"profiles">) => ({ username: p.username ?? null, name: displayName(p) });

async function follows(ctx: Ctx, followerId: string, followeeId: string) {
  const row = await ctx.db
    .query("follows")
    .withIndex("by_pair", (q) => q.eq("followerId", followerId).eq("followeeId", followeeId))
    .first();
  return row !== null;
}

/** Everyone `me` has blocked or been blocked by (socialRules.blockedPeople). */
async function blockedSet(ctx: Ctx, me: string): Promise<Set<string>> {
  const [mine, theirs] = await Promise.all([
    ctx.db.query("blocks").withIndex("by_blocker", (q) => q.eq("blockerId", me)).take(BLOCK_LIST_MAX),
    ctx.db.query("blocks").withIndex("by_blocked", (q) => q.eq("blockedId", me)).take(BLOCK_LIST_MAX * 4),
  ]);
  return blockedPeople([...mine, ...theirs], me);
}

async function blockRow(ctx: Ctx, blockerId: string, blockedId: string) {
  return ctx.db
    .query("blocks")
    .withIndex("by_pair", (q) => q.eq("blockerId", blockerId).eq("blockedId", blockedId))
    .first();
}

/** A block between the two, whichever way round. */
async function blockedBetween(ctx: Ctx, a: string, b: string): Promise<boolean> {
  return (await blockRow(ctx, a, b)) !== null || (await blockRow(ctx, b, a)) !== null;
}

async function counts(ctx: Ctx, userId: string) {
  const [followers, following] = await Promise.all([
    ctx.db.query("follows").withIndex("by_followee", (q) => q.eq("followeeId", userId)).collect(),
    ctx.db.query("follows").withIndex("by_follower", (q) => q.eq("followerId", userId)).collect(),
  ]);
  return { followers: followers.length, following: following.length };
}

/**
 * A person's Liked songs, newest first, one row per song: all the mutual
 * playlist may show. Private playlists and discoveries stay theirs
 * (socialRules.mutualSource).
 */
async function likedSongs(ctx: Ctx, userId: string) {
  const rows = await ctx.db
    .query("librarySongs")
    .withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", MUTUAL_SOURCE_KIND))
    .collect();
  const seen = new Set<string>();
  return mutualSource(rows)
    .sort((a, b) => b._creationTime - a._creationTime)
    .filter((r) => (seen.has(r.trackId) ? false : (seen.add(r.trackId), true)));
}

const song = (r: { trackId: string; title: string; artist: string; album: string; artwork: string; previewUrl: string; durationMs: number; genre: string; accent: string }) => ({
  trackId: r.trackId,
  title: r.title,
  artist: r.artist,
  album: r.album,
  artwork: r.artwork,
  previewUrl: r.previewUrl,
  durationMs: r.durationMs,
  genre: r.genre,
  accent: r.accent,
});

async function playlistAccess(ctx: Ctx, playlist: Doc<"playlists">) {
  const members = await ctx.db
    .query("playlistMembers")
    .withIndex("by_playlist", (q) => q.eq("playlistId", playlist._id))
    .collect();
  return {
    access: {
      ownerId: playlist.userId,
      visibility: playlist.visibility ?? "private",
      collaborative: playlist.collaborative ?? false,
      members: members.map((m) => m.userId),
    },
    members,
  };
}

// ---------------------------------------------------------------------------
// People and follows
// ---------------------------------------------------------------------------

/** My own follower counts, for the profile screen. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const id = await viewerId(ctx);
    if (!id) return null;
    const profile = await getProfile(ctx, id);
    return { username: profile?.username ?? null, ...(await counts(ctx, id)) };
  },
});

/** Someone's public page: who they are, counts, public playlists and recent shares. */
export const profile = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const me = await viewerId(ctx);
    if (!me) return null;
    const p = await byUsername(ctx, username);
    if (!p || p.suspended) return null;
    if (p.userId !== me) {
      // someone who blocked me isn't there; someone I blocked shows only the way back
      if (await blockRow(ctx, p.userId, me)) return null;
      if (await blockRow(ctx, me, p.userId)) {
        return {
          ...person(p),
          isMe: false,
          blockedByMe: true,
          iFollow: false,
          followsMe: false,
          mutual: false,
          followers: 0,
          following: 0,
          playlists: [],
          posts: [],
        };
      }
    }
    const [c, iFollow, followsMe, playlists, posts] = await Promise.all([
      counts(ctx, p.userId),
      follows(ctx, me, p.userId),
      follows(ctx, p.userId, me),
      ctx.db.query("playlists").withIndex("by_user", (q) => q.eq("userId", p.userId)).collect(),
      ctx.db.query("posts").withIndex("by_user_at", (q) => q.eq("userId", p.userId)).order("desc").take(20),
    ]);
    const isMe = p.userId === me;
    const visible = playlists.filter((pl) => isMe || pl.visibility === "public");
    const withCounts = await Promise.all(
      visible.map(async (pl) => ({
        id: pl._id,
        name: pl.name,
        accent: pl.accent,
        visibility: coerceVisibility(pl.visibility),
        collaborative: pl.collaborative ?? false,
        count: (await ctx.db.query("librarySongs").withIndex("by_playlist", (q) => q.eq("playlistId", pl._id)).collect()).length,
      })),
    );
    return {
      ...person(p),
      isMe,
      blockedByMe: false,
      iFollow,
      followsMe,
      mutual: isMutual(iFollow, followsMe),
      ...c,
      playlists: withCounts,
      posts: posts.map((x) => ({ id: x._id, at: x.at, note: x.note ?? null, track: song(x) })),
    };
  },
});

/** Find people by the start of their @username. */
export const searchPeople = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const me = await viewerId(ctx);
    if (!me) return [];
    const prefix = normalizeUsername(q.replace(/^@/, ""));
    if (!prefix || prefix.length < 2) return [];
    const found = await ctx.db
      .query("profiles")
      .withIndex("by_username", (x) => x.gte("username", prefix).lt("username", `${prefix}￿`))
      .take(12);
    const blocked = await blockedSet(ctx, me);
    const people = found.filter((p) => !p.suspended && p.userId !== me && p.username && !blocked.has(p.userId));
    return Promise.all(people.map(async (p) => ({ ...person(p), iFollow: await follows(ctx, me, p.userId) })));
  },
});

/** The people someone follows, or who follow them. */
export const connections = query({
  args: { username: v.string(), kind: v.union(v.literal("followers"), v.literal("following")) },
  handler: async (ctx, { username, kind }) => {
    const me = await viewerId(ctx);
    if (!me) return [];
    const p = await byUsername(ctx, username);
    if (!p) return [];
    const blocked = await blockedSet(ctx, me);
    if (blocked.has(p.userId)) return [];
    const rows =
      kind === "followers"
        ? await ctx.db.query("follows").withIndex("by_followee", (q) => q.eq("followeeId", p.userId)).take(200)
        : await ctx.db.query("follows").withIndex("by_follower", (q) => q.eq("followerId", p.userId)).take(200);
    const ids = rows.map((r) => (kind === "followers" ? r.followerId : r.followeeId));
    const profiles = await Promise.all(ids.map((id) => getProfile(ctx, id)));
    const out = [];
    for (const x of profiles) {
      if (!x || x.suspended || !x.username || blocked.has(x.userId)) continue;
      out.push({ ...person(x), iFollow: x.userId === me ? null : await follows(ctx, me, x.userId) });
    }
    return out;
  },
});

export const follow = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `follow:${user.id}`, 60, 10 * 60_000);
    const target = await byUsername(ctx, username);
    const problem = followProblem(user.id, target && !target.suspended ? target.userId : null);
    if (problem) throw new ConvexError(problem);
    if (await blockedBetween(ctx, user.id, target!.userId)) throw new ConvexError("You can't follow this account");
    if (await follows(ctx, user.id, target!.userId)) return;
    await ctx.db.insert("follows", { followerId: user.id, followeeId: target!.userId, at: Date.now() });
  },
});

export const unfollow = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const { user } = await requireGatedUser(ctx);
    const target = await byUsername(ctx, username);
    if (!target) return;
    const rows = await ctx.db
      .query("follows")
      .withIndex("by_pair", (q) => q.eq("followerId", user.id).eq("followeeId", target.userId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});

// ---------------------------------------------------------------------------
// Sharing a song to followers
// ---------------------------------------------------------------------------

export const shareToFollowers = mutation({
  args: { track: v.object(trackFields), note: v.optional(v.string()) },
  handler: async (ctx, { track, note }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `post:${user.id}`, 20, 60 * 60_000);
    // only the id is the client's: the card shows the catalogue's own details (songs.ts)
    const safe = await requireSong(ctx, track.trackId);
    const clean = cleanNote(note);
    // sharing the same song twice in a row replaces the first post
    const last = await ctx.db.query("posts").withIndex("by_user_at", (q) => q.eq("userId", user.id)).order("desc").first();
    if (last && last.trackId === safe.trackId) await ctx.db.delete(last._id);
    return ctx.db.insert("posts", { userId: user.id, ...safe, ...(clean ? { note: clean } : {}), at: Date.now() });
  },
});

export const deletePost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const { user } = await requireGatedUser(ctx);
    const post = await ctx.db.get(postId);
    if (post && post.userId === user.id) await ctx.db.delete(postId);
  },
});

/** Songs shared by the people I follow (and by me), newest first. */
export const feed = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewerId(ctx);
    if (!me) return [];
    const following = await ctx.db.query("follows").withIndex("by_follower", (q) => q.eq("followerId", me)).take(300);
    const blocked = await blockedSet(ctx, me);
    const authors = [me, ...following.map((f) => f.followeeId).filter((id) => !blocked.has(id))];
    const lists = await Promise.all(
      authors.map((id) => ctx.db.query("posts").withIndex("by_user_at", (q) => q.eq("userId", id)).order("desc").take(10)),
    );
    const merged = mergeFeed(lists.map((l) => l.map((p) => ({ ...p, id: String(p._id) }))), 30);
    const people = new Map<string, Doc<"profiles"> | null>();
    for (const p of merged) if (!people.has(p.userId)) people.set(p.userId, await getProfile(ctx, p.userId));
    return merged
      .filter((p) => !people.get(p.userId)?.suspended)
      .map((p) => {
        const author = people.get(p.userId) ?? null;
        return {
          id: p._id,
          at: p.at,
          note: p.note ?? null,
          mine: p.userId === me,
          by: author ? person(author) : { username: null, name: "Someone" },
          track: song(p),
        };
      });
  },
});

// ---------------------------------------------------------------------------
// The mutual playlist
// ---------------------------------------------------------------------------

/** For two people who follow each other: songs you both saved, then picks from each other's saves. */
export const mutual = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const me = await viewerId(ctx);
    if (!me) return null;
    const other = await byUsername(ctx, username);
    if (!other || other.suspended || other.userId === me) return null;
    if (await blockedBetween(ctx, me, other.userId)) return null;
    const ok = isMutual(await follows(ctx, me, other.userId), await follows(ctx, other.userId, me));
    if (!ok) return { allowed: false as const, name: displayName(other) };
    const [mine, theirs] = await Promise.all([likedSongs(ctx, me), likedSongs(ctx, other.userId)]);
    const mix = mutualMix(mine, theirs, 60);
    return {
      allowed: true as const,
      name: displayName(other),
      username: other.username ?? null,
      both: mix.both,
      songs: mix.items.map((x) => ({ from: x.from, track: song(x.song) })),
    };
  },
});

// ---------------------------------------------------------------------------
// Shared and collaborative playlists
// ---------------------------------------------------------------------------

/** One playlist with all its songs, whoever added them: for the owner, members, and public visitors. */
export const playlist = query({
  args: { playlistId: v.string() },
  handler: async (ctx, { playlistId }) => {
    const me = await viewerId(ctx);
    const id = ctx.db.normalizeId("playlists", playlistId);
    if (!id) return null;
    const pl = await ctx.db.get(id);
    if (!pl) return null;
    const { access, members } = await playlistAccess(ctx, pl);
    if (!canViewPlaylist(access, me)) return null;
    if (me && me !== pl.userId && (await blockedBetween(ctx, me, pl.userId))) return null;
    const [owner, songs] = await Promise.all([
      getProfile(ctx, pl.userId),
      ctx.db.query("librarySongs").withIndex("by_playlist", (q) => q.eq("playlistId", id)).collect(),
    ]);
    const adders = new Map<string, string>();
    for (const s of songs) if (!adders.has(s.userId)) adders.set(s.userId, displayName(await getProfile(ctx, s.userId)));
    const memberProfiles = await Promise.all(members.map((m) => getProfile(ctx, m.userId)));
    return {
      id: pl._id,
      name: pl.name,
      accent: pl.accent,
      visibility: coerceVisibility(pl.visibility),
      collaborative: pl.collaborative ?? false,
      inviteCode: me === pl.userId ? pl.inviteCode ?? null : access.members.includes(me ?? "") ? pl.inviteCode ?? null : null,
      owner: owner ? person(owner) : { username: null, name: "Someone" },
      isOwner: me === pl.userId,
      isMember: me ? access.members.includes(me) : false,
      canAdd: me ? canAddToPlaylist(access, me) : false,
      // the owner also gets each row's id, for "remove" (never anyone's userId)
      members: members.flatMap((m, i) => {
        const p = memberProfiles[i];
        if (!p) return [];
        return [{ ...person(p), memberId: me === pl.userId ? m._id : null }];
      }),
      songs: songs
        .sort((a, b) => b._creationTime - a._creationTime)
        .map((s) => ({
          addedBy: adders.get(s.userId) ?? "Someone",
          canRemove: me ? canRemoveFromPlaylist(access, me, s.userId) : false,
          track: song(s),
        })),
    };
  },
});

/** The owner makes a playlist public or private, and opens or closes it to collaborators. */
export const setPlaylistSharing = mutation({
  args: { playlistId: v.id("playlists"), visibility: v.optional(v.string()), collaborative: v.optional(v.boolean()) },
  handler: async (ctx, { playlistId, visibility, collaborative }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `playlist:share:${user.id}`, 60, 10 * 60_000);
    const pl = await ctx.db.get(playlistId);
    if (!pl || pl.userId !== user.id) throw new ConvexError("Only the owner can change this");
    const patch: Partial<Doc<"playlists">> = {};
    if (visibility !== undefined) patch.visibility = coerceVisibility(visibility);
    if (collaborative !== undefined) patch.collaborative = collaborative;
    // an invite link exists while the owner shares; un-sharing takes it down
    const next = {
      visibility: patch.visibility ?? pl.visibility,
      collaborative: patch.collaborative ?? pl.collaborative,
    };
    const change = inviteCodeChange(next, !!pl.inviteCode);
    if (change === "issue") patch.inviteCode = await freshCode(ctx, PLAYLIST_CODE_LENGTH, "playlist");
    if (change === "revoke") patch.inviteCode = undefined;
    await ctx.db.patch(playlistId, patch);
    // neither public nor collaborative: it's private again, so nobody else keeps it
    if (membersAfterSharing(next) === "removeAll") {
      for (const m of await ctx.db.query("playlistMembers").withIndex("by_playlist", (q) => q.eq("playlistId", playlistId)).collect()) {
        await dropMember(ctx, m);
      }
    }
    return { inviteCode: change === "keep" ? pl.inviteCode ?? null : patch.inviteCode ?? null };
  },
});

/** Join a playlist from its invite link. Members can add songs while it's collaborative. */
export const joinPlaylist = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `playlist:join:${user.id}`, 30, 10 * 60_000);
    const clean = normalizeCode(code);
    const pl = clean ? await ctx.db.query("playlists").withIndex("by_inviteCode", (q) => q.eq("inviteCode", clean)).unique() : null;
    // a link to a playlist the owner has stopped sharing opens nothing
    if (!pl || !inviteOpen(pl)) throw new ConvexError("That invite link doesn't work any more");
    if (pl.userId === user.id) return { playlistId: pl._id };
    // the same answer as a dead link: a block isn't announced
    if (await blockedBetween(ctx, user.id, pl.userId)) throw new ConvexError("That invite link doesn't work any more");
    const already = await ctx.db
      .query("playlistMembers")
      .withIndex("by_pair", (q) => q.eq("playlistId", pl._id).eq("userId", user.id))
      .first();
    if (!already) await ctx.db.insert("playlistMembers", { playlistId: pl._id, userId: user.id, at: Date.now() });
    return { playlistId: pl._id };
  },
});

/** Take someone out of a playlist, and stop their swipe-downs landing in it. */
async function dropMember(ctx: MutationCtx, m: Doc<"playlistMembers">) {
  await ctx.db.delete(m._id);
  const p = await getProfile(ctx, m.userId);
  if (p && p.saveTarget === `pl:${m.playlistId}`) await ctx.db.patch(p._id, { saveTarget: "liked" });
}

/** The owner takes one member out. Songs they added stay; the owner can remove those too. */
export const removeMember = mutation({
  args: { playlistId: v.id("playlists"), memberId: v.id("playlistMembers") },
  handler: async (ctx, { playlistId, memberId }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `playlist:share:${user.id}`, 60, 10 * 60_000);
    const pl = await ctx.db.get(playlistId);
    if (!pl || pl.userId !== user.id) throw new ConvexError("Only the owner can change this");
    const m = await ctx.db.get(memberId);
    if (!m || m.playlistId !== playlistId) return;
    await dropMember(ctx, m);
  },
});

export const leavePlaylist = mutation({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    const { user, profile } = await requireGatedUser(ctx);
    const rows = await ctx.db
      .query("playlistMembers")
      .withIndex("by_pair", (q) => q.eq("playlistId", playlistId).eq("userId", user.id))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    // saving into a playlist you've left would fail: fall back to Liked
    if (profile.saveTarget === `pl:${playlistId}`) await ctx.db.patch(profile._id, { saveTarget: "liked" });
  },
});

/** Add one song to a playlist you own or collaborate on (from a feed post, the mutual playlist, a room…). */
export const addToPlaylist = mutation({
  args: { playlistId: v.id("playlists"), track: v.object(trackFields) },
  handler: async (ctx, { playlistId, track }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `playlist:add:${user.id}`, 120, 60_000);
    const pl = await ctx.db.get(playlistId);
    if (!pl) throw new ConvexError("Playlist not found");
    const { access } = await playlistAccess(ctx, pl);
    if (!canAddToPlaylist(access, user.id)) throw new ConvexError("You can't add songs to this playlist");
    const safe = await requireSong(ctx, track.trackId);
    const dup = (await ctx.db.query("librarySongs").withIndex("by_playlist", (q) => q.eq("playlistId", playlistId)).collect()).some(
      (s) => s.trackId === safe.trackId,
    );
    if (dup) return;
    await ctx.db.insert("librarySongs", { userId: user.id, kind: "playlist", playlistId, ...safe });
  },
});

export const removeFromPlaylist = mutation({
  args: { playlistId: v.id("playlists"), trackId: v.string() },
  handler: async (ctx, { playlistId, trackId }) => {
    const { user } = await requireGatedUser(ctx);
    const pl = await ctx.db.get(playlistId);
    if (!pl) return;
    const { access } = await playlistAccess(ctx, pl);
    const rows = (await ctx.db.query("librarySongs").withIndex("by_playlist", (q) => q.eq("playlistId", playlistId)).collect()).filter(
      (s) => s.trackId === cleanText(trackId, 120),
    );
    for (const r of rows) {
      if (!canRemoveFromPlaylist(access, user.id, r.userId)) throw new ConvexError("Only the owner or whoever added it can remove a song");
      await ctx.db.delete(r._id);
    }
  },
});

/** The playlist an invite code points at, for the join screen (name and owner only). */
export const invite = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const clean = normalizeCode(code);
    if (!clean) return null;
    const pl = await ctx.db.query("playlists").withIndex("by_inviteCode", (q) => q.eq("inviteCode", clean)).unique();
    if (!pl || !inviteOpen(pl)) return null;
    const me = await viewerId(ctx);
    if (me && me !== pl.userId && (await blockedBetween(ctx, me, pl.userId))) return null;
    const owner = await getProfile(ctx, pl.userId);
    const count = (await ctx.db.query("librarySongs").withIndex("by_playlist", (q) => q.eq("playlistId", pl._id)).collect()).length;
    return { playlistId: pl._id, name: pl.name, accent: pl.accent, collaborative: pl.collaborative ?? false, owner: owner ? person(owner) : null, count };
  },
});

async function freshCode(ctx: MutationCtx, length: number, kind: "playlist" | "room") {
  for (let i = 0; i < 8; i++) {
    const code = makeCode(length, secureRandom);
    const taken =
      kind === "playlist"
        ? await ctx.db.query("playlists").withIndex("by_inviteCode", (q) => q.eq("inviteCode", code)).first()
        : await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (!taken) return code;
  }
  throw new ConvexError("Couldn't make a code, try again");
}

// ---------------------------------------------------------------------------
// Listening rooms ("play together")
// ---------------------------------------------------------------------------

/** Open a room on the host's next songs. The code is what friends type or tap to join. */
export const createRoom = mutation({
  args: { trackIds: v.array(v.string()) },
  handler: async (ctx, { trackIds }) => {
    const { user, profile } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `room:create:${user.id}`, 10, 60 * 60_000);
    // bounded before any work: the array arrives straight from the client
    const wanted = [...new Set(trackIds.slice(0, ROOM_MAX_TRACKS * 4).map((t) => cleanText(t, 120)).filter(Boolean))].slice(0, ROOM_MAX_TRACKS);
    // songs that exist: a made-up id would be dealt to everyone in the room
    const ids = await knownSongIds(ctx, wanted);
    if (ids.length < 2) throw new ConvexError("A room needs a few songs to start");
    // one open room per host: opening a new one closes the last
    const now = Date.now();
    for (const old of await ctx.db.query("rooms").withIndex("by_host", (q) => q.eq("hostId", user.id)).collect()) {
      if (!old.endedAt) await ctx.db.patch(old._id, { endedAt: now });
    }
    const code = await freshCode(ctx, ROOM_CODE_LENGTH, "room");
    const roomId = await ctx.db.insert("rooms", {
      code,
      hostId: user.id,
      hostName: displayName(profile),
      trackIds: ids,
      index: 0,
      songStartedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("roomMembers", { roomId, userId: user.id, name: displayName(profile), joinedAt: now, lastSeen: now });
    return { code };
  },
});

async function openRoom(ctx: Ctx, code: string) {
  const clean = normalizeCode(code);
  if (!clean) return null;
  const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", clean)).unique();
  return room && roomIsOpen(room, Date.now()) ? room : null;
}

export const joinRoom = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const { user, profile } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `room:join:${user.id}`, 30, 10 * 60_000);
    const room = await openRoom(ctx, code);
    if (!room) throw new ConvexError("That room has closed");
    if (room.hostId !== user.id && (await blockedBetween(ctx, user.id, room.hostId))) throw new ConvexError("That room has closed");
    const now = Date.now();
    const members = await ctx.db.query("roomMembers").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect();
    const mine = members.find((m) => m.userId === user.id);
    if (mine) {
      await ctx.db.patch(mine._id, { lastSeen: now });
    } else {
      const here = members.filter((m) => now - m.lastSeen < ROOM_PRESENCE_MS).length;
      if (here >= ROOM_MAX_MEMBERS) throw new ConvexError("This room is full");
      await ctx.db.insert("roomMembers", { roomId: room._id, userId: user.id, name: displayName(profile), joinedAt: now, lastSeen: now });
    }
    return { code: room.code };
  },
});

/** "Still here": keeps a member on the room's list while their tab is open. */
export const roomHeartbeat = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const { user } = await requireGatedUser(ctx);
    const room = await openRoom(ctx, code);
    if (!room) return;
    const mine = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", room._id).eq("userId", user.id))
      .first();
    if (mine) await ctx.db.patch(mine._id, { lastSeen: Date.now() });
  },
});

/** The host moves everyone on to the next song. */
export const advanceRoom = mutation({
  args: { code: v.string(), expected: v.number() },
  handler: async (ctx, { code, expected }) => {
    const { user } = await requireGatedUser(ctx);
    const room = await openRoom(ctx, code);
    if (!room) return { ended: true };
    if (room.hostId !== user.id) throw new ConvexError("Only the host moves the room on");
    const next = nextRoomIndex(room.index, expected, room.trackIds.length);
    const now = Date.now();
    if (next === null) {
      if (expected === room.index && room.index + 1 >= room.trackIds.length) {
        await ctx.db.patch(room._id, { endedAt: now, updatedAt: now });
        return { ended: true };
      }
      return { ended: false };
    }
    await ctx.db.patch(room._id, { index: next, songStartedAt: now, updatedAt: now });
    return { ended: false };
  },
});

export const endRoom = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const { user } = await requireGatedUser(ctx);
    const room = await openRoom(ctx, code);
    if (room && room.hostId === user.id) await ctx.db.patch(room._id, { endedAt: Date.now() });
  },
});

/** A save or skip in the room, shown to everyone else. (The save itself goes through library:recordSwipe.) */
export const reactInRoom = mutation({
  args: { code: v.string(), trackId: v.string(), action: v.union(v.literal("save"), v.literal("skip")) },
  handler: async (ctx, { code, trackId, action }) => {
    const { user, profile } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `room:react:${user.id}`, 120, 60_000);
    const room = await openRoom(ctx, code);
    if (!room) return;
    const id = cleanText(trackId, 120);
    if (!room.trackIds.includes(id)) return;
    // only people in the room speak in it: knowing the code isn't joining
    const member = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", room._id).eq("userId", user.id))
      .first();
    if (!member) throw new ConvexError("Join the room first");
    const prior =(await ctx.db.query("roomReactions").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect()).filter(
      (r) => r.userId === user.id && r.trackId === id,
    );
    for (const r of prior) await ctx.db.delete(r._id);
    await ctx.db.insert("roomReactions", { roomId: room._id, userId: user.id, name: displayName(profile), trackId: id, action, at: Date.now() });
    await ctx.db.patch(room._id, { updatedAt: Date.now() });
  },
});

/** The live room: which song is on, who's here, and what they did with it. */
export const room = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const me = await viewerId(ctx);
    if (!me) return null;
    const clean = normalizeCode(code);
    const r = clean ? await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", clean)).unique() : null;
    if (!r) return null;
    if (r.hostId !== me && (await blockedBetween(ctx, me, r.hostId))) return null;
    const open = roomIsOpen(r, Date.now());
    const [members, reactions] = await Promise.all([
      ctx.db.query("roomMembers").withIndex("by_room", (q) => q.eq("roomId", r._id)).collect(),
      ctx.db.query("roomReactions").withIndex("by_room", (q) => q.eq("roomId", r._id)).collect(),
    ]);
    const current = r.trackIds[r.index];
    return {
      code: r.code,
      open,
      isHost: r.hostId === me,
      isMember: members.some((m) => m.userId === me),
      hostName: r.hostName,
      index: r.index,
      total: r.trackIds.length,
      trackIds: r.trackIds,
      currentTrackId: current,
      songStartedAt: r.songStartedAt,
      members: members.map((m) => ({ name: m.name, me: m.userId === me, host: m.userId === r.hostId, lastSeen: m.lastSeen })),
      reactions: reactions
        .filter((x) => x.trackId === current)
        .sort((a, b) => b.at - a.at)
        .map((x) => ({ name: x.name, me: x.userId === me, action: x.action })),
      saves: reactions.filter((x) => x.action === "save").length,
    };
  },
});

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

/**
 * Undo every tie between two people: follows both ways (which also ends their
 * mutual playlist), each one's membership of the other's playlists, and each
 * one's place in a room the other hosts.
 */
async function separate(ctx: MutationCtx, a: string, b: string) {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const rows = await ctx.db
      .query("follows")
      .withIndex("by_pair", (q) => q.eq("followerId", x).eq("followeeId", y))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);

    // y's memberships of playlists x owns
    for (const m of await ctx.db.query("playlistMembers").withIndex("by_user", (q) => q.eq("userId", y)).collect()) {
      const pl = await ctx.db.get(m.playlistId);
      if (!pl || pl.userId !== x) continue;
      await ctx.db.delete(m._id);
      const member = await getProfile(ctx, y);
      if (member && member.saveTarget === `pl:${pl._id}`) await ctx.db.patch(member._id, { saveTarget: "liked" });
    }

    // y's seats in rooms x hosts
    for (const m of await ctx.db.query("roomMembers").withIndex("by_user", (q) => q.eq("userId", y)).collect()) {
      const room = await ctx.db.get(m.roomId);
      if (room && room.hostId === x) await ctx.db.delete(m._id);
    }
  }
}

/** Block someone: they disappear from each other's social side, both ways. */
export const block = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `block:${user.id}`, 60, 60 * 60_000);
    const target = await byUsername(ctx, username);
    const problem = blockProblem(user.id, target ? target.userId : null);
    if (problem) throw new ConvexError(problem);
    const them = target!.userId;
    if (!(await blockRow(ctx, user.id, them))) {
      const held = await ctx.db.query("blocks").withIndex("by_blocker", (q) => q.eq("blockerId", user.id)).take(BLOCK_LIST_MAX);
      if (held.length >= BLOCK_LIST_MAX) throw new ConvexError("You've blocked as many people as you can");
      await ctx.db.insert("blocks", { blockerId: user.id, blockedId: them, at: Date.now() });
    }
    await separate(ctx, user.id, them);
  },
});

/** Lift a block. Follows it removed stay removed. */
export const unblock = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const { user } = await requireGatedUser(ctx);
    await enforceRateLimit(ctx, `block:${user.id}`, 60, 60 * 60_000);
    const target = await byUsername(ctx, username);
    if (!target) return;
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_pair", (q) => q.eq("blockerId", user.id).eq("blockedId", target.userId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});

/** The people I've blocked, for Settings. Never who blocked me. */
export const blocked = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewerId(ctx);
    if (!me) return [];
    const rows = await ctx.db.query("blocks").withIndex("by_blocker", (q) => q.eq("blockerId", me)).take(BLOCK_LIST_MAX);
    const out = [];
    for (const r of rows.sort((a, b) => b.at - a.at)) {
      const p = await getProfile(ctx, r.blockedId);
      if (p?.username) out.push(person(p));
    }
    return out;
  },
});
