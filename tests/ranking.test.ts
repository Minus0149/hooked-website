import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildQueue,
  NO_STEER,
  rankPool,
  spreadAlbums,
  uniqueById,
  type Steer,
} from "../src/data/ranking";
import { EMPTY_TASTE } from "../src/data/taste";
import { featuresOf, trainTaste } from "../src/data/predict";
import type { Track } from "../src/types";

/**
 * These weights decide what every listener hears, and until the ranking left
 * the reducer nothing could reach them without driving a whole store through a
 * swipe. What is checked here is the ordering of confidence — that what
 * someone said outranks what the crowd implies, which outranks one gesture —
 * and that none of it can overwhelm the shuffle, because a deck that always
 * deals the same card first is a playlist.
 */

const track = (id: string, over: Partial<Track> = {}): Track => ({
  id,
  title: id,
  artist: "artist " + id,
  album: "album",
  artwork: "art-" + id,
  previewUrl: "",
  durationMs: 30_000,
  genre: "pop",
  accent: "#ff2d55",
  ...over,
});

const pool = (n: number, over: (i: number) => Partial<Track> = () => ({})) =>
  Array.from({ length: n }, (_, i) => track("t" + i, over(i)));

const steer = (over: Partial<Steer> = {}): Steer => ({ ...NO_STEER, ...over });

/**
 * A seeded shuffle, so these are experiments rather than coin flips.
 *
 * Ranking is deliberately random — that is the point of shuffling first — and
 * an unseeded assertion about where a track lands is a test that fails a few
 * times a year for no reason. Pinning Math.random makes every number below
 * exact and repeatable while leaving the code under test untouched.
 */
function seedRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

beforeEach(() => {
  vi.spyOn(Math, "random").mockImplementation(seedRandom(20260901));
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Average position of a track across enough shuffles to see past the noise. */
function meanPlace(id: string, tracks: Track[], s: Steer, runs = 400): number {
  let total = 0;
  for (let i = 0; i < runs; i++) total += rankPool(tracks, s).findIndex((t) => t.id === id);
  return total / runs;
}

describe("rankPool", () => {
  it("keeps every track, exactly once", () => {
    const tracks = pool(30);
    const out = rankPool(tracks, steer());
    expect(out).toHaveLength(30);
    expect(new Set(out.map((t) => t.id)).size).toBe(30);
  });

  it("does not deal the same card first every time", () => {
    const tracks = pool(30);
    const firsts = new Set(Array.from({ length: 40 }, () => rankPool(tracks, steer())[0].id));
    expect(firsts.size).toBeGreaterThan(5);
  });

  it("pulls a track the model likes forward", () => {
    const tracks = pool(40);
    const favoured = steer({ affinity: { t20: 1 }, affinityStrength: 9 });
    expect(meanPlace("t20", tracks, favoured)).toBeLessThan(meanPlace("t20", tracks, steer()));
  });

  it("pushes back a track the model links to something they buried", () => {
    const tracks = pool(40);
    const disliked = steer({ affinity: { t20: -1 }, affinityStrength: 9 });
    expect(meanPlace("t20", tracks, disliked)).toBeGreaterThan(meanPlace("t20", tracks, steer()));
  });

  it("ignores affinity entirely when an admin turns the strength to zero", () => {
    // an absurd score, switched off: the deck must come out identical, card
    // for card, to one that was never given a model at all
    const tracks = pool(40);
    const off = rankPool(tracks, steer({ affinity: { t20: 500 }, affinityStrength: 0 }));
    vi.spyOn(Math, "random").mockImplementation(seedRandom(20260901));
    const none = rankPool(tracks, steer());
    expect(off.map((t) => t.id)).toEqual(none.map((t) => t.id));
  });

  it("lets a stated taste outrank the model", () => {
    // t5 is what they asked for; t20 is what the crowd suggests
    const tracks = pool(40, (i) => ({ genre: i === 5 ? "hip-hop/rap" : "pop" }));
    const both = steer({
      taste: { ...EMPTY_TASTE, genres: ["hiphop"] },
      affinity: { t20: 1 },
      affinityStrength: 9,
    });
    expect(meanPlace("t5", tracks, both)).toBeLessThan(meanPlace("t20", tracks, both));
  });

  it("lets the model outrank a single right-swipe", () => {
    const tracks = pool(40, (i) => ({ genre: i === 5 ? "rock" : "pop" }));
    const both = steer({
      boostGenres: ["rock"],
      affinity: { t20: 1 },
      affinityStrength: 9,
    });
    expect(meanPlace("t20", tracks, both)).toBeLessThan(meanPlace("t5", tracks, both));
  });

  it("cannot pin a favourite to the front of a big catalogue", () => {
    // the shuffle index is the dominant term by design: a nudge is a nudge
    const tracks = pool(200);
    const favoured = steer({ affinity: { t100: 1 }, affinityStrength: 9 });
    expect(meanPlace("t100", tracks, favoured, 40)).toBeGreaterThan(3);
  });
});

describe("buildQueue", () => {
  it("leaves out what the deck has already spent and who they blocked", () => {
    const tracks = [
      track("a"),
      track("b"),
      track("c", { artist: "blocked" }),
      ...pool(10).map((t) => track("x" + t.id)),
    ];
    const out = buildQueue(tracks, new Set(["a"]), ["blocked"], steer());
    const ids = out.map((t) => t.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("c");
    expect(ids).toContain("b");
  });

  it("loops the catalogue rather than dead-ending when everything is spent", () => {
    const tracks = pool(6);
    const out = buildQueue(tracks, new Set(tracks.map((t) => t.id)), [], steer());
    expect(out.length).toBe(6);
  });

  it("still honours a block when it loops", () => {
    const tracks = [...pool(5), track("nope", { artist: "blocked" })];
    const out = buildQueue(tracks, new Set(tracks.map((t) => t.id)), ["blocked"], steer());
    expect(out.map((t) => t.id)).not.toContain("nope");
  });
});

describe("queue hygiene", () => {
  it("drops duplicate ids — two cards with one key render as a stuck deck", () => {
    expect(uniqueById([track("a"), track("b"), track("a")]).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("separates neighbours that share album art", () => {
    const same = { artwork: "one-cover" };
    const out = spreadAlbums([
      track("a", same),
      track("b", same),
      track("c", { artwork: "other" }),
      track("d", same),
    ]);
    expect(out[0].artwork).toBe("one-cover");
    expect(out[1].artwork).not.toBe(out[0].artwork);
  });

  it("never moves the card already on screen", () => {
    const head = track("head", { artwork: "same" });
    const out = spreadAlbums([head, track("b", { artwork: "same" }), track("c")]);
    expect(out[0].id).toBe("head");
  });
});

/**
 * A mood is the only signal that is about *now* rather than about the person,
 * which is why it outranks everything else — and why it must never become a
 * filter. Both halves of that are checked here: the faces move the deck, and
 * the deck still deals everything.
 */
describe("the mood lens", () => {
  const mixed = [
    ...Array.from({ length: 10 }, (_, i) => track("party" + i, { genre: "house" })),
    ...Array.from({ length: 10 }, (_, i) => track("quiet" + i, { genre: "Ghazals" })),
  ];

  it("brings the mood forward without shutting anything out", () => {
    const off = meanPlace("quiet0", mixed, steer());
    const on = meanPlace("quiet0", mixed, steer({ mood: "tender" }));
    expect(on).toBeLessThan(off - 2);
    // every card is still in the deck — a lens, not a playlist
    expect(rankPool(mixed, steer({ mood: "tender" }))).toHaveLength(20);
  });

  it("pushes the wrong mood back, but not out", () => {
    const loudWithTender = meanPlace("party0", mixed, steer({ mood: "tender" }));
    const loudWithParty = meanPlace("party0", mixed, steer({ mood: "party" }));
    expect(loudWithParty).toBeLessThan(loudWithTender);
    expect(
      rankPool(mixed, steer({ mood: "tender" })).some((t) => t.id === "party0"),
    ).toBe(true);
  });

  it("changes nothing when nobody picked a face", () => {
    const withLens = rankPool(mixed, steer({ mood: null })).map((t) => t.id);
    vi.spyOn(Math, "random").mockImplementation(seedRandom(20260901));
    const without = rankPool(mixed, steer({ moodStrength: 0 })).map((t) => t.id);
    expect(withLens).toEqual(without);
  });

  it("honours the crowd's opinion of a track over its genre", () => {
    // one pop song that eight listeners called a party record
    const pool = [
      ...Array.from({ length: 12 }, (_, i) => track("p" + i, { genre: "pop" })),
    ];
    const crowd = { p0: { party: 8 } };
    const tagged = meanPlace("p0", pool, steer({ mood: "party", crowdMoods: crowd }));
    const untagged = meanPlace("p0", pool, steer({ mood: "party" }));
    expect(tagged).toBeLessThan(untagged);
  });

  it("can be turned off from the dashboard", () => {
    const on = meanPlace("quiet0", mixed, steer({ mood: "tender" }));
    const off = meanPlace("quiet0", mixed, steer({ mood: "tender", moodStrength: 0 }));
    expect(off).toBeGreaterThan(on);
  });
});

describe("the learned model's pull", () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => track("house" + i, { genre: "house" })),
    ...Array.from({ length: 10 }, (_, i) => track("metal" + i, { genre: "metal" })),
  ];
  const trained = trainTaste([
    ...Array.from({ length: 10 }, (_, i) =>
      track("h" + i, { genre: "house", artist: "a" + i }),
    ).map((t) => ({ features: featuresOf(t), label: 1 as const, weight: 1 })),
    ...Array.from({ length: 10 }, (_, i) =>
      track("m" + i, { genre: "metal", artist: "b" + i }),
    ).map((t) => ({ features: featuresOf(t), label: 0 as const, weight: 1 })),
  ]);

  it("moves what it has learned they keep toward the front", () => {
    const blind = meanPlace("house0", pool, steer());
    const taught = meanPlace("house0", pool, steer({ model: trained }));
    expect(taught).toBeLessThan(blind - 2);
  });

  it("moves what it has learned they bury toward the back", () => {
    const blind = meanPlace("metal0", pool, steer());
    const taught = meanPlace("metal0", pool, steer({ model: trained }));
    expect(taught).toBeGreaterThan(blind + 2);
  });

  it("does nothing on a first session", () => {
    // ten saves and no burials: an opinion with no evidence behind it
    const oneSided = trainTaste(
      Array.from({ length: 10 }, (_, i) =>
        track("h" + i, { genre: "house", artist: "a" + i }),
      ).map((t) => ({ features: featuresOf(t), label: 1 as const, weight: 1 })),
    );
    const order = rankPool(pool, steer({ model: oneSided })).map((t) => t.id);
    vi.spyOn(Math, "random").mockImplementation(seedRandom(20260901));
    const untouched = rankPool(pool, steer()).map((t) => t.id);
    expect(order).toEqual(untouched);
  });
});
