import { describe, expect, it } from "vitest";
import { auc, evaluate, type Swipe } from "../scripts/lib/evaluate";
import type { Track } from "../src/types";

describe("scoring a ranker", () => {
  it("is 1 when every kept song outscores every dropped one, 0.5 for a tie", () => {
    expect(auc([0.9, 0.8, 0.1, 0.2], [1, 1, 0, 0])).toBe(1);
    expect(auc([0.5, 0.5], [1, 0])).toBe(0.5);
    expect(auc([0.1, 0.9], [1, 0])).toBe(0);
  });
  it("refuses to score an exam with only one outcome", () => {
    expect(auc([0.3, 0.4], [1, 1])).toBeNull();
  });
});

describe("the holdout test", () => {
  // two genres; this listener keeps every hip-hop song and skips every folk one
  const catalog: Track[] = Array.from({ length: 40 }, (_, i) => ({
    id: `t${i}`, title: `t${i}`, artist: `artist${i}`, album: "", artwork: "", previewUrl: "",
    durationMs: 30000, genre: i % 2 ? "hip-hop/rap" : "folk", accent: "#fff",
  }));
  const swipes: Swipe[] = catalog.map((t, i) => ({
    userId: "u1", trackId: t.id, action: t.genre === "folk" ? "skip" : "save", t: i,
  }));

  it("finds a real preference that a shuffle can't", () => {
    const r = evaluate(swipes, catalog);
    const byName = Object.fromEntries(r.rankers.map((x) => [x.name, x.auc]));
    expect(r.users).toBe(1);
    expect(byName["label model"]).toBeGreaterThan(0.9);
    expect(Math.abs(byName["shuffle"] - 0.5)).toBeLessThan(0.35);
  });

  it("trains only on the past: the exam is the latest swipes", () => {
    const r = evaluate(swipes, catalog, { trainShare: 0.8 });
    expect(r.examSwipes).toBe(8);
  });

  it("skips listeners with too little history to split", () => {
    expect(evaluate(swipes.slice(0, 6), catalog).users).toBe(0);
  });
});
