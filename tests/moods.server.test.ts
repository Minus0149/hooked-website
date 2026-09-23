import { describe, expect, it } from "vitest";
import {
  applyVote,
  isMood,
  MOOD_IDS,
  publishable,
  summariseMoods,
  type Counts,
} from "../convex/moods";
import { MOOD_IDS as CLIENT_MOOD_IDS } from "../src/data/mood";

/**
 * The tally is the part of the mood feature nobody can see. A decrement that
 * misses leaves a vote behind that no person is attached to, and from the
 * outside a phantom looks exactly like a listener — the tag simply stays on a
 * song forever and everyone gets recommended it on the wrong night.
 */

describe("the two lists of moods", () => {
  it("still agree", () => {
    // The Convex bundle and the client bundle are built separately, so the
    // taxonomy is written twice. This is the seam where that becomes a bug:
    // add a face to one side and the other silently rejects every vote for it.
    expect([...MOOD_IDS].sort()).toEqual([...CLIENT_MOOD_IDS].sort());
  });

  it("refuses anything that isn't one of them", () => {
    expect(isMood("party")).toBe(true);
    expect(isMood("PARTY")).toBe(false);
    expect(isMood("__proto__")).toBe(false);
    expect(isMood("")).toBe(false);
  });
});

describe("counting votes", () => {
  const first = (counts: Counts, mood: string) => counts.find((c) => c.mood === mood)?.n ?? 0;

  it("counts a first vote", () => {
    expect(applyVote([], null, "party")).toEqual([{ mood: "party", n: 1 }]);
  });

  it("moves a vote rather than adding a second one", () => {
    const after = applyVote([{ mood: "party", n: 3 }], "party", "tender");
    expect(first(after, "party")).toBe(2);
    expect(first(after, "tender")).toBe(1);
  });

  it("does nothing when someone presses the same face again", () => {
    const before: Counts = [{ mood: "party", n: 2 }];
    expect(applyVote(before, "party", "party")).toEqual(before);
  });

  it("drops a mood nobody holds any more, rather than keeping a nought", () => {
    const after = applyVote([{ mood: "party", n: 1 }], "party", "sleepy");
    expect(after.some((c) => c.mood === "party")).toBe(false);
    expect(after).toEqual([{ mood: "sleepy", n: 1 }]);
  });

  it("never goes negative, even from a row that was already wrong", () => {
    const after = applyVote([{ mood: "party", n: 0 }], "party", "chill");
    for (const c of after) expect(c.n).toBeGreaterThan(0);
  });

  it("throws away a mood the app no longer has", () => {
    // an old client, or a row written before a face was retired
    const after = applyVote([{ mood: "brooding", n: 9 }], null, "chill");
    expect(after.map((c) => c.mood)).toEqual(["chill"]);
  });

  it("keeps the strongest first, and ties in a stable order", () => {
    const counts = applyVote(
      [
        { mood: "chill", n: 1 },
        { mood: "party", n: 5 },
        { mood: "sunny", n: 1 },
      ],
      null,
      "tender",
    );
    expect(counts[0].mood).toBe("party");
    expect(counts.slice(1).map((c) => c.mood)).toEqual(["chill", "sunny", "tender"]);
  });
});

describe("what leaves the server", () => {
  const counts: Counts = [
    { mood: "party", n: 5 },
    { mood: "chill", n: 2 },
    { mood: "tender", n: 1 },
  ];

  it("holds back a tag only one person gave", () => {
    expect(publishable(counts, 2).map((c) => c.mood)).toEqual(["party", "chill"]);
  });

  it("can be tightened from the dashboard", () => {
    expect(publishable(counts, 5).map((c) => c.mood)).toEqual(["party"]);
  });

  it("never publishes on a floor of zero — that would be a config typo", () => {
    expect(publishable([{ mood: "party", n: 0 }], 0)).toEqual([]);
  });
});

/**
 * The dashboard is where a counting mistake gets read as a fact about
 * listeners, so the summary is pinned against a small hand-built world.
 */
describe("the dashboard's mood summary", () => {
  const tracks = [
    { trackId: "a", title: "A", artist: "x", artwork: "", energy: 0.95 },
    { trackId: "b", title: "B", artist: "y", artwork: "", energy: 0.1 },
    { trackId: "c", title: "C", artist: "z", artwork: "" },
    { trackId: "gone", title: "Hidden", artist: "q", artwork: "", energy: 0.5, hidden: true },
  ];
  const votes = [
    { userId: "u1", trackId: "a", mood: "party" },
    { userId: "u2", trackId: "a", mood: "party" },
    { userId: "u3", trackId: "a", mood: "party" },
    { userId: "u1", trackId: "b", mood: "tender" },
    { userId: "u2", trackId: "c", mood: "sleepy" },
  ];
  const tallies = [
    { trackId: "a", counts: [{ mood: "party", n: 3 }] },
    { trackId: "b", counts: [{ mood: "tender", n: 1 }] },
    { trackId: "c", counts: [{ mood: "sleepy", n: 1 }] },
  ];
  const s = summariseMoods(votes, tallies, tracks, 2);

  it("counts votes and the distinct people behind them", () => {
    expect(s.votes).toBe(5);
    expect(s.voters).toBe(3);
  });

  it("separates what was tagged from what cleared the floor", () => {
    expect(s.tagged).toBe(3);
    expect(s.published).toBe(1); // only 'a', with three agreeing
  });

  it("reports every mood, including the ones nobody used", () => {
    expect(s.byMood.map((m) => m.mood).sort()).toEqual([...MOOD_IDS].sort());
    expect(s.byMood.find((m) => m.mood === "hyped")?.votes).toBe(0);
    expect(s.byMood.find((m) => m.mood === "party")).toMatchObject({ votes: 3, tracks: 1 });
  });

  it("never lists a below-floor track as a top track", () => {
    expect(s.top.find((t) => t.mood === "tender")?.tracks).toEqual([]);
    expect(s.top.find((t) => t.mood === "party")?.tracks[0]).toMatchObject({ trackId: "a", n: 3 });
  });

  it("measures energy coverage on live tracks only, in five bands", () => {
    expect(s.energy.total).toBe(3); // the hidden one doesn't count
    expect(s.energy.analysed).toBe(2);
    expect(s.energy.buckets).toEqual([1, 0, 0, 0, 1]);
  });
});
