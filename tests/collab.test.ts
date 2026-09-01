import { describe, expect, it } from "vitest";
import {
  ACTION_WEIGHT,
  buildNeighbors,
  scoreCandidates,
  userVector,
  type Interaction,
} from "../convex/collab";

/**
 * The recommender is the one part of the app whose output nobody can eyeball.
 * A ranking that is subtly wrong still looks like a list of songs, so these
 * check the properties that would be invisible in the deck: that a popular
 * track doesn't become everyone's neighbour, that one enthusiast can't define
 * the catalogue, and that nothing is published on a single person's say-so.
 */

const swipe = (userId: string, trackId: string, action: Interaction["action"]): Interaction => ({
  userId,
  trackId,
  action,
});

/** n listeners who all saved the same two tracks. */
function agreeingCrowd(size: number, a: string, b: string): Interaction[] {
  return Array.from({ length: size }, (_, i) => [
    swipe(`u${i}`, a, "save"),
    swipe(`u${i}`, b, "save"),
  ]).flat();
}

describe("gesture weights", () => {
  it("treats a skip as far weaker evidence than a bury", () => {
    expect(Math.abs(ACTION_WEIGHT.skip)).toBeLessThan(Math.abs(ACTION_WEIGHT.never) / 4);
  });

  it("ranks a save above a steer, and both above nothing", () => {
    expect(ACTION_WEIGHT.save).toBeGreaterThan(ACTION_WEIGHT.more);
    expect(ACTION_WEIGHT.more).toBeGreaterThan(0);
  });
});

describe("neighbour building", () => {
  it("links two tracks the same people saved", () => {
    const model = buildNeighbors(agreeingCrowd(4, "a", "b"));
    expect(model.neighbors.get("a")?.[0]).toMatchObject({ trackId: "b" });
    expect(model.neighbors.get("b")?.[0]).toMatchObject({ trackId: "a" });
    expect(model.neighbors.get("a")?.[0].score).toBeCloseTo(1, 3);
  });

  it("publishes nothing from a single listener", () => {
    // one person, four saves — a complete taste profile, and still not a fact
    // about the catalogue that anyone else may read
    const solo = ["a", "b", "c", "d"].map((t) => swipe("solo", t, "save"));
    expect(buildNeighbors(solo).neighbors.size).toBe(0);
  });

  it("holds a pair back until enough separate people link it", () => {
    const rows = [
      ...agreeingCrowd(3, "a", "b"),
      // 'c' is rated by three people, so it is eligible — but only one of them
      // links it to 'a', which is below the support floor
      swipe("u0", "c", "save"),
      swipe("u1", "c", "skip"),
      swipe("u2", "c", "skip"),
    ];
    const model = buildNeighbors(rows, { minSupport: 2 });
    const fromA = model.neighbors.get("a")?.map((n) => n.trackId) ?? [];
    expect(fromA).toContain("b");

    // lower the bar and the same data does link them
    const loose = buildNeighbors(rows, { minSupport: 1 });
    expect(loose.neighbors.get("a")?.map((n) => n.trackId)).toContain("c");
  });

  it("ignores tracks too few people have reacted to", () => {
    const rows = [...agreeingCrowd(3, "a", "b"), swipe("u0", "rare", "save")];
    const model = buildNeighbors(rows, { minRaters: 3 });
    expect(model.neighbors.has("rare")).toBe(false);
    expect(model.rated).toBe(2);
  });

  it("gives opposite reactions a negative link", () => {
    // everyone who saved 'a' buried 'b'
    const rows = Array.from({ length: 4 }, (_, i) => [
      swipe(`u${i}`, "a", "save"),
      swipe(`u${i}`, "b", "never"),
    ]).flat();
    const score = buildNeighbors(rows).neighbors.get("a")?.[0].score ?? 0;
    expect(score).toBeLessThan(0);
  });

  it("does not let a popular track become everyone's neighbour", () => {
    // 'hit' is saved by all twelve listeners; 'x' and 'y' only by the first
    // three. Raw co-occurrence would rank hit->x top by sheer volume; cosine
    // normalisation is what stops it.
    const rows: Interaction[] = [];
    for (let i = 0; i < 12; i++) rows.push(swipe(`u${i}`, "hit", "save"));
    for (let i = 0; i < 3; i++) {
      rows.push(swipe(`u${i}`, "x", "save"), swipe(`u${i}`, "y", "save"));
    }
    const model = buildNeighbors(rows, { minRaters: 3 });
    const xy = model.neighbors.get("x")?.find((n) => n.trackId === "y")?.score ?? 0;
    const xhit = model.neighbors.get("x")?.find((n) => n.trackId === "hit")?.score ?? 0;
    // x and y are perfectly correlated; x and the hit are not
    expect(xy).toBeGreaterThan(xhit);
  });

  it("caps how much of one listener's history counts", () => {
    const rows: Interaction[] = [];
    for (let i = 0; i < 10; i++) rows.push(swipe("whale", `t${i}`, "save"));
    for (let i = 0; i < 10; i++) rows.push(swipe("other", `t${i}`, "save"));
    // only the first three reactions of each are considered
    const model = buildNeighbors(rows, { perUserCap: 3, minRaters: 2, minSupport: 2 });
    expect(model.rated).toBe(3);
    expect(model.neighbors.has("t9")).toBe(false);
  });

  it("keeps only the strongest neighbours", () => {
    const rows: Interaction[] = [];
    for (let i = 0; i < 4; i++) {
      rows.push(swipe(`u${i}`, "seed", "save"));
      for (let t = 0; t < 10; t++) rows.push(swipe(`u${i}`, `t${t}`, "save"));
    }
    const model = buildNeighbors(rows, { topK: 4 });
    expect(model.neighbors.get("seed")?.length).toBe(4);
  });

  it("reports a truncated run instead of pretending it finished", () => {
    const rows: Interaction[] = [];
    for (let i = 0; i < 4; i++) {
      for (let t = 0; t < 20; t++) rows.push(swipe(`u${i}`, `t${t}`, "save"));
    }
    expect(buildNeighbors(rows, { maxPairs: 10 }).truncated).toBe(true);
    expect(buildNeighbors(rows).truncated).toBe(false);
  });

  it("takes the newest verdict when someone swiped a track twice", () => {
    // the log arrives newest-first, so the bury is the current opinion
    const rows = [
      swipe("u0", "a", "never"),
      swipe("u0", "a", "save"),
      swipe("u1", "a", "never"),
      swipe("u2", "a", "never"),
      ...["u0", "u1", "u2"].map((u) => swipe(u, "b", "never")),
    ];
    // three people buried both: agreement, so a positive link
    expect(buildNeighbors(rows).neighbors.get("a")?.[0].score).toBeGreaterThan(0);
  });
});

describe("scoring a listener's candidates", () => {
  const model = buildNeighbors(agreeingCrowd(4, "a", "b"));

  it("recommends the neighbour of something they saved", () => {
    const scores = scoreCandidates(model.neighbors, new Map([["a", 1]]));
    expect(scores.get("b")).toBeGreaterThan(0);
  });

  it("pushes back the neighbour of something they buried", () => {
    const scores = scoreCandidates(model.neighbors, new Map([["a", -0.9]]));
    expect(scores.get("b")).toBeLessThan(0);
  });

  it("never recommends what they have already answered", () => {
    const scores = scoreCandidates(
      model.neighbors,
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
    );
    expect(scores.has("b")).toBe(false);
    expect(scores.has("a")).toBe(false);
  });

  it("is empty for a listener with no history", () => {
    expect(scoreCandidates(model.neighbors, new Map()).size).toBe(0);
  });

  it("does not inflate scores for people with bigger libraries", () => {
    // two listeners, identical taste, one has answered four times as often.
    // Their scores for the same candidate must be comparable, because the deck
    // blends both against the same shuffle.
    const rows: Interaction[] = [];
    for (let i = 0; i < 4; i++) {
      rows.push(swipe(`u${i}`, "target", "save"));
      for (const seed of ["s0", "s1", "s2", "s3"]) rows.push(swipe(`u${i}`, seed, "save"));
    }
    const built = buildNeighbors(rows).neighbors;
    const light = scoreCandidates(built, new Map([["s0", 1]])).get("target") ?? 0;
    const heavy = scoreCandidates(
      built,
      new Map([
        ["s0", 1],
        ["s1", 1],
        ["s2", 1],
        ["s3", 1],
      ]),
    ).get("target") ?? 0;
    expect(heavy).toBeCloseTo(light, 3);
  });
});

describe("the listener's own vector", () => {
  it("keeps the newest reaction per track and stops at the cap", () => {
    const rows = [
      swipe("me", "a", "save"),
      swipe("me", "a", "never"),
      swipe("me", "b", "more"),
      swipe("me", "c", "skip"),
    ];
    const vector = userVector(rows, 2);
    expect(vector.get("a")).toBe(ACTION_WEIGHT.save);
    expect(vector.size).toBe(2);
    expect(vector.has("c")).toBe(false);
  });
});

/**
 * The three pieces meet in exactly one place — a listener's swipes go in, a
 * deck order comes out — and each of them is tested alone above. This is the
 * seam: a sign error in scoreCandidates or a mismatched track id between the
 * model and the catalogue would pass every test so far and still hand someone
 * a deck ranked backwards.
 */
describe("end to end: a crowd, then one listener's deck", () => {
  const indie = ["indie-a", "indie-b", "indie-c"];
  const metal = ["metal-a", "metal-b"];

  /** Twelve listeners who agree with themselves: indie fans, and metal fans. */
  const crowd: Interaction[] = [];
  for (let i = 0; i < 6; i++) {
    for (const t of indie) crowd.push(swipe(`indie${i}`, t, "save"));
    for (const t of metal) crowd.push(swipe(`indie${i}`, t, "never"));
  }
  for (let i = 0; i < 6; i++) {
    for (const t of metal) crowd.push(swipe(`metal${i}`, t, "save"));
    for (const t of indie) crowd.push(swipe(`metal${i}`, t, "never"));
  }

  const model = buildNeighbors(crowd).neighbors;

  it("recommends the rest of the taste from two songs", () => {
    // a newcomer who saved two indie tracks and has never met the third
    const scores = scoreCandidates(model, userVector([
      swipe("new", "indie-a", "save"),
      swipe("new", "indie-b", "save"),
    ]));
    expect(scores.get("indie-c")).toBeGreaterThan(0);
    for (const t of metal) expect(scores.get(t)).toBeLessThan(0);
  });

  it("reads a bury as a bury, not just a weaker save", () => {
    const scores = scoreCandidates(model, userVector([swipe("new", "indie-a", "never")]));
    expect(scores.get("indie-c")).toBeLessThan(0);
    expect(scores.get("metal-a")).toBeGreaterThan(0);
  });

  it("says nothing at all about a track nobody has reached yet", () => {
    const scores = scoreCandidates(model, userVector([swipe("new", "indie-a", "save")]));
    expect(scores.has("brand-new-single")).toBe(false);
  });
});
