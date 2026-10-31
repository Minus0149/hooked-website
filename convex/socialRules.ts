import { ConvexError } from "convex/values";
/**
 * The rules behind the social side of HookedCue: following, sharing a song to
 * followers, shared and collaborative playlists, the mutual playlist two people
 * get when they follow each other, and listening together in a room.
 *
 * No Convex imports, on purpose (like matching.ts and collab.ts): every
 * decision about who may see or change what lives here, as plain functions
 * tested against fixed inputs in tests/social.test.ts.
 */

export type Visibility = "private" | "public";
export type AfterHook = "next" | "loop" | "continue";

/** What happens when the last hook of a song runs out. "next" is how the deck has always behaved. */
export const AFTER_HOOK: { id: AfterHook; label: string; hint: string }[] = [
  { id: "next", label: "Next song", hint: "Move on to the next card" },
  { id: "loop", label: "Loop the hook", hint: "Play the hook again until you swipe" },
  { id: "continue", label: "Keep playing", hint: "Play the rest of the 30-second clip" },
];

export function coerceAfterHook(v: unknown): AfterHook {
  return v === "loop" || v === "continue" ? v : "next";
}

/**
 * What the player does when a hook window ends. `hooksLeft` is how many more
 * windows the song still has after this one.
 */
export function afterHookAction(mode: AfterHook, hooksLeft: number): "nextHook" | "nextSong" | "restart" | "playOn" {
  if (hooksLeft > 0) return "nextHook";
  if (mode === "loop") return "restart";
  if (mode === "continue") return "playOn";
  return "nextSong";
}

export type PlaylistAccess = {
  ownerId: string;
  visibility?: string | null;
  collaborative?: boolean | null;
  /** userIds that joined through the invite link */
  members: string[];
};

/** Anyone may look at a public playlist; a private one only its owner and members. */
export function canViewPlaylist(p: PlaylistAccess, viewerId: string | null): boolean {
  if (p.visibility === "public") return true;
  if (!viewerId) return false;
  return viewerId === p.ownerId || p.members.includes(viewerId);
}

/** Songs go in from the owner, or from members while the playlist is collaborative. */
export function canAddToPlaylist(p: PlaylistAccess, userId: string): boolean {
  if (userId === p.ownerId) return true;
  return p.collaborative === true && p.members.includes(userId);
}

/** A song can be taken out by the owner, or by whoever put it there. */
export function canRemoveFromPlaylist(p: PlaylistAccess, userId: string, addedBy: string): boolean {
  return userId === p.ownerId || userId === addedBy;
}

export function coerceVisibility(v: unknown): Visibility {
  return v === "public" ? "public" : "private";
}

/** Following someone needs a different, real account; you can't follow yourself. */
export function followProblem(followerId: string, followeeId: string | null): string | null {
  if (!followeeId) return "No one with that username";
  if (followerId === followeeId) return "You can't follow yourself";
  return null;
}

/** Two people are mutuals when each follows the other: that's what unlocks a mutual playlist. */
export function isMutual(aFollowsB: boolean, bFollowsA: boolean): boolean {
  return aFollowsB && bFollowsA;
}

/**
 * What the mutual playlist draws from: each person's Liked songs, nothing else.
 * It used to read every saved row, so a follow-back showed the other person
 * their private playlists and discoveries too. A playlist is shared only when
 * its owner shares it (visibility / collaborative), never by following.
 */
export const MUTUAL_SOURCE_KIND = "liked" as const;

export function mutualSource<T extends { kind: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.kind === MUTUAL_SOURCE_KIND);
}

export type SongRef = { trackId: string };

/**
 * The mutual playlist: the songs both people saved, then what each saved that
 * the other hasn't heard yet, interleaved so neither side drowns the other.
 * Order inside each list follows the input (newest first, as the library is).
 */
export function mutualMix<T extends SongRef>(mine: readonly T[], theirs: readonly T[], limit = 60) {
  const mineIds = new Set(mine.map((s) => s.trackId));
  const theirIds = new Set(theirs.map((s) => s.trackId));
  const seen = new Set<string>();
  const uniq = (list: readonly T[]) => list.filter((s) => (seen.has(s.trackId) ? false : (seen.add(s.trackId), true)));
  const both = uniq(mine.filter((s) => theirIds.has(s.trackId)));
  const fromThem = uniq(theirs.filter((s) => !mineIds.has(s.trackId)));
  const fromMe = uniq(mine.filter((s) => !theirIds.has(s.trackId)));
  const mixed: { song: T; from: "both" | "them" | "me" }[] = both.map((song) => ({ song, from: "both" as const }));
  for (let i = 0; mixed.length < limit && (i < fromThem.length || i < fromMe.length); i++) {
    if (i < fromThem.length) mixed.push({ song: fromThem[i], from: "them" });
    if (mixed.length < limit && i < fromMe.length) mixed.push({ song: fromMe[i], from: "me" });
  }
  return { both: both.length, items: mixed.slice(0, limit) };
}

/**
 * Codes for invite links and listening rooms: no 0/O or 1/I/L, so a code read
 * out loud or off a screen can't be mistyped. `rand` is injected so tests are
 * deterministic; the server passes secureRandom (convex/secureRandom.ts), never
 * Math.random — a code is the only thing standing between a stranger and the
 * playlist or room it opens.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** 31^8 ≈ 8.5 × 10^11 codes each: far beyond guessing at any rate a client can reach. */
export const PLAYLIST_CODE_LENGTH = 8;
export const ROOM_CODE_LENGTH = 8;

/**
 * An invite link only works while the owner is sharing the playlist (public or
 * collaborative). Turning both off takes the link down with it.
 */
export function inviteOpen(p: { visibility?: string | null; collaborative?: boolean | null }): boolean {
  return p.visibility === "public" || p.collaborative === true;
}

/**
 * What a sharing change does to the invite link: the first share issues one,
 * un-sharing revokes it (so sharing again later hands out a new link, and an
 * old one forwarded around stops working), anything else leaves it alone.
 */
export function inviteCodeChange(
  next: { visibility?: string | null; collaborative?: boolean | null },
  hasCode: boolean,
): "issue" | "revoke" | "keep" {
  const open = inviteOpen(next);
  if (open && !hasCode) return "issue";
  if (!open && hasCode) return "revoke";
  return "keep";
}
export function makeCode(length: number, rand: () => number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return out;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 12);
}

/** A room lasts while people are in it; one nobody has touched for 6 hours is over. */
export const ROOM_IDLE_MS = 6 * 60 * 60_000;
export const ROOM_MAX_TRACKS = 60;
export const ROOM_MAX_MEMBERS = 12;
/** a member who hasn't checked in for this long is shown as gone */
export const ROOM_PRESENCE_MS = 45_000;

export function roomIsOpen(room: { endedAt?: number | null; updatedAt: number }, now: number): boolean {
  if (room.endedAt) return false;
  return now - room.updatedAt < ROOM_IDLE_MS;
}

/**
 * Moving the room on. Only the host moves it, and only from the index they
 * were looking at — so two quick taps, or a stale tab, can't skip a song.
 */
export function nextRoomIndex(current: number, expected: number, length: number): number | null {
  if (expected !== current) return null;
  if (current + 1 >= length) return null;
  return current + 1;
}

/** Feed posts: a short note at most, no links (they'd be a spam channel). */
export function cleanNote(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!text) return undefined;
  if (/https?:\/\/|www\./i.test(text)) throw new ConvexError("Notes can't contain links");
  return text;
}

/** Newest first across everyone you follow, at most `limit`, one copy of each post. */
export function mergeFeed<T extends { id: string; at: number }>(lists: readonly (readonly T[])[], limit = 40): T[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/**
 * The name other people see. A sign-up fills `name` with the email's local
 * part ("subhash2004ka" for subhash2004ka@gmail.com), and that was shown on
 * profiles, playlists and in rooms to anyone signed in — half an email address.
 * A name that is just the email's local part is treated as no name: people see
 * the @username instead, or "Someone".
 */
export function publicName(p: { name?: string | null; email?: string | null; username?: string | null } | null): string {
  if (!p) return "Someone";
  const name = (p.name ?? "").trim();
  const local = (p.email ?? "").split("@")[0].trim().toLowerCase();
  const fromEmail = !name || (local !== "" && name.toLowerCase() === local);
  if (!fromEmail) return name;
  return p.username ? `@${p.username}` : "Someone";
}
