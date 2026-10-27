import { v, ConvexError } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { trackFields } from "./schema";
import { cleanText, cleanTrack, enforceRateLimit, getProfile, requireGatedUser } from "./security";
import { normalizeUsername } from "../src/lib/username";
import {
  ROOM_MAX_MEMBERS,
  ROOM_MAX_TRACKS,
  ROOM_PRESENCE_MS,
  canAddToPlaylist,
  canRemoveFromPlaylist,
  canViewPlaylist,
  cleanNote,
  coerceVisibility,
  followProblem,
  isMutual,
  PLAYLIST_CODE_LENGTH,
  ROOM_CODE_LENGTH,
  inviteCodeChange,
  inviteOpen,
  makeCode,
  mergeFeed,
  mutualMix,
  nextRoomIndex,
  normalizeCode,
  publicName,
  roomIsOpen,
} from "./socialRules";
import { secureRandom } from "./secureRandom";

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

async function counts(ctx: Ctx, userId: string) {
  const [followers, following] = await Promise.all([
    ctx.db.query("follows").withIndex("by_followee", (q) => q.eq("followeeId", userId)).collect(),
    ctx.db.query("follows").withIndex("by_follower", (q) => q.eq("followerId", userId)).collect(),
  ]);
  return { followers: followers.length, following: following.length };
}

/** Everything a person has saved, newest first, one row per song. */
async function savedSongs(ctx: Ctx, userId: string) {
  const rows = await ctx.db
    .query("librarySongs")
    .withIndex("by_user_kind", (q) => q.eq("userId", userId))
    .collect();
  const seen = new Set<string>();
  return rows
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
    const people = found.filter((p) => !p.suspended && p.userId !== me && p.username);
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
    const rows =
      kind === "followers"
        ? await ctx.db.query("follows").withIndex("by_followee", (q) => q.eq("followeeId", p.userId)).take(200)
        : await ctx.db.query("follows").withIndex("by_follower", (q) => q.eq("followerId", p.userId)).take(200);
    const ids = rows.map((r) => (kind === "followers" ? r.followerId : r.followeeId));
    const profiles = await Promise.all(ids.map((id) => getProfile(ctx, id)));
    const out = [];
    for (const x of profiles) {
      if (!x || x.suspended || !x.username) continue;
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
    const safe = cleanTrack(track);
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
    const authors = [me, ...following.map((f) => f.followeeId)];
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
    const ok = isMutual(await follows(ctx, me, other.userId), await follows(ctx, other.userId, me));
    if (!ok) return { allowed: false as const, name: displayName(other) };
    const [mine, theirs] = await Promise.all([savedSongs(ctx, me), savedSongs(ctx, other.userId)]);
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
      members: memberProfiles.filter((m): m is Doc<"profiles"> => m !== null).map(person),
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
    const already = await ctx.db
      .query("playlistMembers")
      .withIndex("by_pair", (q) => q.eq("playlistId", pl._id).eq("userId", user.id))
      .first();
    if (!already) await ctx.db.insert("playlistMembers", { playlistId: pl._id, userId: user.id, at: Date.now() });
    return { playlistId: pl._id };
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
    const safe = cleanTrack(track);
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
    const ids = [...new Set(trackIds.slice(0, ROOM_MAX_TRACKS * 4).map((t) => cleanText(t, 120)).filter(Boolean))].slice(0, ROOM_MAX_TRACKS);
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

