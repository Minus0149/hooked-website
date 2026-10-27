import { describe, expect, it } from "vitest";
import {
  afterHookAction,
  canAddToPlaylist,
  canRemoveFromPlaylist,
  canViewPlaylist,
  cleanNote,
  coerceAfterHook,
  coerceVisibility,
  followProblem,
  isMutual,
  makeCode,
  mergeFeed,
  mutualMix,
  nextRoomIndex,
  normalizeCode,
  roomIsOpen,
  ROOM_IDLE_MS,
} from "../convex/socialRules";
import { coercePrefs, DEFAULT_PREFS } from "../src/data/prefs";
import { pathForView, routeFor } from "../src/lib/routes";

/**
 * The social side's rules: who may see and change a playlist, when two people
 * get a mutual playlist, how rooms move on, and what happens when a hook ends.
 */

describe("when a hook ends", () => {
  it("walks the song's other hooks first, whatever the setting", () => {
    for (const mode of ["next", "loop", "continue"] as const) expect(afterHookAction(mode, 2)).toBe("nextHook");
  });
  it("then moves on, loops, or plays the rest of the clip", () => {
    expect(afterHookAction("next", 0)).toBe("nextSong");
    expect(afterHookAction("loop", 0)).toBe("restart");
    expect(afterHookAction("continue", 0)).toBe("playOn");
  });
  it("defaults to the old behaviour for anything unknown, and is a synced pref", () => {
    expect(coerceAfterHook("sideways")).toBe("next");
    expect(DEFAULT_PREFS.afterHook).toBe("next");
    expect(coercePrefs({ afterHook: "loop" }).afterHook).toBe("loop");
    expect(coercePrefs({}).afterHook).toBe("next");
  });
});

describe("playlist access", () => {
  const priv = { ownerId: "owner", visibility: "private", collaborative: false, members: ["friend"] };
  const collab = { ...priv, collaborative: true };
  const pub = { ...priv, visibility: "public", members: [] };

  it("a private playlist is for its owner and members only", () => {
    expect(canViewPlaylist(priv, "owner")).toBe(true);
    expect(canViewPlaylist(priv, "friend")).toBe(true);
    expect(canViewPlaylist(priv, "stranger")).toBe(false);
    expect(canViewPlaylist(priv, null)).toBe(false);
  });
  it("a public one opens for anyone, but only the owner adds unless it's collaborative", () => {
    expect(canViewPlaylist(pub, "stranger")).toBe(true);
    expect(canAddToPlaylist(pub, "stranger")).toBe(false);
    expect(canAddToPlaylist(pub, "owner")).toBe(true);
  });
  it("members add songs only while it's collaborative", () => {
    expect(canAddToPlaylist(priv, "friend")).toBe(false);
    expect(canAddToPlaylist(collab, "friend")).toBe(true);
    expect(canAddToPlaylist(collab, "stranger")).toBe(false);
  });
  it("a song comes out by the owner or whoever added it", () => {
    expect(canRemoveFromPlaylist(collab, "owner", "friend")).toBe(true);
    expect(canRemoveFromPlaylist(collab, "friend", "friend")).toBe(true);
    expect(canRemoveFromPlaylist(collab, "friend", "owner")).toBe(false);
  });
  it("visibility is private unless it says public", () => {
    expect(coerceVisibility("public")).toBe("public");
    expect(coerceVisibility("everyone")).toBe("private");
  });
});

describe("follows and mutuals", () => {
  it("you can't follow yourself or no one", () => {
    expect(followProblem("a", "a")).toMatch(/yourself/);
    expect(followProblem("a", null)).toMatch(/No one/);
    expect(followProblem("a", "b")).toBeNull();
  });
  it("mutual means both ways", () => {
    expect(isMutual(true, true)).toBe(true);
    expect(isMutual(true, false)).toBe(false);
  });
  it("the mutual playlist: shared saves first, then picks from each side, alternating, no repeats", () => {
    const s = (id: string) => ({ trackId: id });
    const mine = [s("a"), s("b"), s("c"), s("x")];
    const theirs = [s("x"), s("d"), s("e"), s("a")];
    const mix = mutualMix(mine, theirs, 10);
    expect(mix.both).toBe(2);
    expect(mix.items.map((i) => `${i.from}:${i.song.trackId}`)).toEqual([
      "both:a", "both:x", "them:d", "me:b", "them:e", "me:c",
    ]);
    expect(mutualMix(mine, theirs, 3).items).toHaveLength(3);
  });
});

describe("rooms and codes", () => {
  it("codes avoid the characters people misread", () => {
    let i = 0;
    const seq = [0, 0.5, 0.99, 0.2, 0.7, 0.33];
    const code = makeCode(6, () => seq[i++ % seq.length]);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(normalizeCode(" ab-c 12 ")).toBe("ABC12");
  });
  it("only the host's current index moves the room, and never past the end", () => {
    expect(nextRoomIndex(3, 3, 10)).toBe(4);
    expect(nextRoomIndex(3, 2, 10)).toBeNull(); // a stale tap
    expect(nextRoomIndex(9, 9, 10)).toBeNull(); // the last song
  });
  it("a room closes when ended or idle for hours", () => {
    expect(roomIsOpen({ updatedAt: 1000 }, 2000)).toBe(true);
    expect(roomIsOpen({ updatedAt: 1000, endedAt: 1500 }, 2000)).toBe(false);
    expect(roomIsOpen({ updatedAt: 0 }, ROOM_IDLE_MS + 1)).toBe(false);
  });
});

describe("feed", () => {
  it("notes are short and carry no links", () => {
    expect(cleanNote("  this   one\nslaps ")).toBe("this one slaps");
    expect(cleanNote("")).toBeUndefined();
    expect(() => cleanNote("listen at https://spam.example")).toThrow(/links/);
    expect(cleanNote("x".repeat(300))).toHaveLength(140);
  });
  it("newest first across everyone, each post once", () => {
    const a = [{ id: "1", at: 10 }, { id: "2", at: 30 }];
    const b = [{ id: "3", at: 20 }, { id: "2", at: 30 }];
    expect(mergeFeed([a, b]).map((p) => p.id)).toEqual(["2", "3", "1"]);
    expect(mergeFeed([a, b], 2)).toHaveLength(2);
  });
});

describe("social addresses", () => {
  it("round-trips every social screen", () => {
    for (const view of ["people", "user:minus", "mutual:minus", "playlist:abc123", "invite:K7P2QX9M", "room:ABC234"] as const) {
      const r = routeFor(pathForView(view));
      expect(r).toEqual({ kind: "app", view });
    }
  });
  it("reads invite and room codes in any case, and keeps playlist ids as typed", () => {
    expect(routeFor("/together/abc234")).toEqual({ kind: "app", view: "room:ABC234" });
    expect(routeFor("/join-playlist/k7p2qx9m")).toEqual({ kind: "app", view: "invite:K7P2QX9M" });
    expect(routeFor("/playlist/AbC")).toEqual({ kind: "app", view: "playlist:AbC" });
  });
});
