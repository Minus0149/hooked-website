import { describe, expect, it } from "vitest";
import {
  buildExamples,
  confidence,
  featuresOf,
  likeBias,
  likeChance,
  reasons,
  trainFromHistory,
  trainTaste,
  verdict,
} from "../src/data/predict";
import type { Track } from "../src/types";

/**
 * This is the one part of the app that makes a claim about a person — "you will
 * like this, 84%" — and a model that is confidently wrong is worse than no
 * model, because the deck spends its best positions on it and the UI puts a
 * number next to it.
 *
 * So the properties tested here are mostly about restraint: that a model with
 * one-sided evidence has no influence and shows no number, that a skip is not
 * read as a bury, that no single artist can become the whole model, and that
 * the same history always produces the same answer — because "why is this song
 * here" has to survive being asked twice.
 */

const track = (id: string, over: Partial<Track> = {}): Track => ({
  id,
  title: id,
  artist: "artist " + id,
  album: "album",
  artwork: "art",
  previewUrl: "",
  durationMs: 30_000,
  genre: "pop",
  accent: "#ff2d55",
  ...over,
});

/** n tracks of one genre, each by its own artist. */
const batch = (n: number, prefix: string, over: Partial<Track> = {}) =>
  Array.from({ length: n }, (_, i) => track(`${prefix}${i}`, { artist: `${prefix} artist ${i}`, ...over }));

describe("what a track looks like to the model", () => {
  it("describes a track by category, never by which track it is", () => {
    const f = featuresOf(track("t1", { genre: "house", artist: "Jai", markets: ["in"], heat: 0.9 }));
    expect(f).toContain("g:house");
    expect(f).toContain("b:dance");
    expect(f).toContain("a:jai");
    expect(f).toContain("m:in");
    expect(f).toContain("heat:hi");
    expect(f).toContain("mood:party");
    // a model that learns individual songs can only re-recommend what they have
    expect(f.some((k) => k.includes("t1"))).toBe(false);
  });

  it("says nothing about what it cannot measure", () => {
    const f = featuresOf(track("t2", { genre: "", artist: "", markets: [] }));
    expect(f.some((k) => k.startsWith("heat:"))).toBe(false);
    expect(f.some((k) => k.startsWith("nrg:"))).toBe(false);
    expect(f.some((k) => k.startsWith("g:"))).toBe(false);
  });

  it("carries measured loudness when the analyser has been round", () => {
    expect(featuresOf(track("t3", { energy: 0.92 }))).toContain("nrg:hi");
    expect(featuresOf(track("t4", { energy: 0.05 }))).toContain("nrg:lo");
  });
});

describe("learning from one listener's own swipes", () => {
  const saved = batch(10, "house", { genre: "house" });
  const buried = batch(10, "metal", { genre: "metal" });
  const rows = [
    ...saved.map((t) => ({ features: featuresOf(t), label: 1 as const, weight: 1 })),
    ...buried.map((t) => ({ features: featuresOf(t), label: 0 as const, weight: 1 })),
  ];
  const model = trainTaste(rows);

  it("learns nothing from nothing", () => {
    expect(trainTaste([])).toBeNull();
  });

  it("separates what they kept from what they buried", () => {
    const yes = likeChance(model, track("new", { genre: "deep house" }));
    const no = likeChance(model, track("new2", { genre: "metal" }));
    expect(yes).toBeGreaterThan(0.5);
    expect(no).toBeLessThan(0.5);
    expect(yes - no).toBeGreaterThan(0.3);
  });

  it("generalises to a genre string it has never seen", () => {
    // "tech house" was never in the training set; the dance bucket was
    expect(likeChance(model, track("x", { genre: "tech house" }))).toBeGreaterThan(0.5);
  });

  it("falls back to the base rate for a track it can say nothing about", () => {
    const blank = likeChance(model, track("blank", { genre: "", artist: "", markets: [] }));
    expect(blank).toBeGreaterThan(0.2);
    expect(blank).toBeLessThan(0.8);
  });

  it("gives the same answer twice", () => {
    const again = trainTaste(rows);
    expect(again!.bias).toBe(model!.bias);
    expect(again!.weights).toEqual(model!.weights);
  });

  it("can name its reasons", () => {
    const why = reasons(model, track("y", { genre: "house" }));
    expect(why.length).toBeGreaterThan(0);
    expect(why.join(" ").toLowerCase()).toContain("dance");
  });

  it("keeps one artist from becoming the whole model", () => {
    // ten saves, all the same artist, all the same genre: the artist weight
    // must not run away from the genre weight it is confounded with
    const oneArtist = batch(10, "solo", { genre: "house", artist: "One Guy" }).map((t) => ({
      features: featuresOf(t),
      label: 1 as const,
      weight: 1,
    }));
    const lopsided = trainTaste([...oneArtist, ...buried.map((t) => ({
      features: featuresOf(t),
      label: 0 as const,
      weight: 1,
    }))])!;
    expect(lopsided.weights["a:one guy"]).toBeLessThan(2);
  });

  it("produces no NaN, whatever it is fed", () => {
    const odd = trainTaste([
      { features: [], label: 1, weight: 1 },
      { features: ["g:x"], label: 0, weight: 0 },
    ])!;
    expect(Number.isFinite(odd.bias)).toBe(true);
    for (const w of Object.values(odd.weights)) expect(Number.isFinite(w)).toBe(true);
    expect(Number.isFinite(likeChance(odd, track("q")))).toBe(true);
  });
});

describe("knowing when to keep quiet", () => {
  const onlySaves = batch(12, "house", { genre: "house" }).map((t) => ({
    features: featuresOf(t),
    label: 1 as const,
    weight: 1,
  }));

  it("has no confidence in a model that has only seen yes", () => {
    const model = trainTaste(onlySaves);
    expect(confidence(model)).toBe(0);
    // ...and therefore no influence on the deck, whatever it "thinks"
    expect(likeBias(model, track("z", { genre: "house" }))).toBe(0);
    expect(verdict(model, track("z", { genre: "house" })).worthShowing).toBe(false);
  });

  it("ramps with evidence on the thinner side", () => {
    const withNegatives = (n: number) =>
      trainTaste([
        ...onlySaves,
        ...batch(n, "metal", { genre: "metal" }).map((t) => ({
          features: featuresOf(t),
          label: 0 as const,
          weight: 1,
        })),
      ]);
    expect(confidence(withNegatives(2))).toBeCloseTo(0.2, 5);
    expect(confidence(withNegatives(5))).toBeCloseTo(0.5, 5);
    expect(confidence(withNegatives(10))).toBe(1);
    expect(confidence(withNegatives(40))).toBe(1);
  });

  it("has no opinion at all without a model", () => {
    expect(confidence(null)).toBe(0);
    expect(likeBias(null, track("a"))).toBe(0);
    expect(likeChance(null, track("a"))).toBe(0.5);
    expect(reasons(null, track("a"))).toEqual([]);
  });

  it("pushes both ways, and centres on this listener's own base rate", () => {
    const model = trainTaste([
      ...batch(12, "house", { genre: "house" }).map((t) => ({
        features: featuresOf(t),
        label: 1 as const,
        weight: 1,
      })),
      ...batch(12, "metal", { genre: "metal" }).map((t) => ({
        features: featuresOf(t),
        label: 0 as const,
        weight: 1,
      })),
    ]);
    expect(likeBias(model, track("h", { genre: "house" }))).toBeGreaterThan(0.2);
    expect(likeBias(model, track("m", { genre: "metal" }))).toBeLessThan(-0.2);
    // bounded, so it can never outrun the shuffle it is biasing
    for (const genre of ["house", "metal", "pop", ""]) {
      const bias = likeBias(model, track("b", { genre }));
      expect(bias).toBeGreaterThanOrEqual(-1);
      expect(bias).toBeLessThanOrEqual(1);
    }
  });
});

describe("building the training set from a library", () => {
  const catalog = [
    ...batch(3, "house", { genre: "house" }),
    ...batch(3, "metal", { genre: "metal" }),
    track("skipped-once", { genre: "country" }),
  ];

  it("reads saves as yes and buried songs as no", () => {
    const rows = buildExamples({
      saved: [catalog[0]],
      buried: ["metal0"],
      skipped: [],
      catalog,
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.label === 1)).toHaveLength(1);
    expect(rows.filter((r) => r.label === 0)).toHaveLength(1);
  });

  it("weighs a single skip far below a bury", () => {
    const rows = buildExamples({
      saved: [],
      buried: ["metal0"],
      skipped: ["skipped-once"],
      catalog,
    });
    const skip = rows.find((r) => r.weight < 1)!;
    const bury = rows.find((r) => r.weight === 1)!;
    expect(skip.weight).toBeLessThan(bury.weight / 3);
  });

  it("counts a song they saved after skipping it as a save", () => {
    const rows = buildExamples({
      saved: [catalog[0]],
      buried: [],
      skipped: [catalog[0].id],
      catalog,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe(1);
  });

  it("ignores ids the catalogue no longer carries", () => {
    const rows = buildExamples({
      saved: [],
      buried: ["a-track-that-was-hidden"],
      skipped: [],
      catalog,
    });
    expect(rows).toEqual([]);
  });

  it("trains end to end from a library shape the store already holds", () => {
    const model = trainFromHistory({
      saved: batch(10, "house", { genre: "house" }),
      buried: ["metal0", "metal1", "metal2"],
      skipped: ["skipped-once"],
      catalog: [...catalog, ...batch(10, "house", { genre: "house" })],
    })!;
    expect(model.positives).toBe(10);
    expect(model.negatives).toBe(4);
    expect(likeChance(model, track("fresh", { genre: "progressive house" }))).toBeGreaterThan(
      likeChance(model, track("fresh2", { genre: "metal" })),
    );
  });
});
