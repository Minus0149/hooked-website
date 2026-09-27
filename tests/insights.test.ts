import { describe, expect, it } from "vitest";
import {
  emptySkipAt,
  PRIVACY_FLOOR,
  publicInsights,
  shares,
  skipBucket,
  stillListening,
  type InsightRow,
} from "../convex/insightsRules";

/**
 * Artists get their hook's numbers for free — and never a listener. These pin
 * down the arithmetic and, more importantly, the privacy floor.
 */
const row = (over: Partial<InsightRow> = {}): InsightRow => ({
  listeners: 40,
  plays: 40,
  saves: 8,
  skips: 24,
  more: 2,
  never: 1,
  skipAt: emptySkipAt(),
  moods: {},
  genres: {},
  ...over,
});

describe("hook insights", () => {
  it("shows nothing until enough people have heard the song", () => {
    expect(publicInsights(row({ listeners: PRIVACY_FLOOR - 1 }))).toEqual({ enough: false, floor: PRIVACY_FLOOR });
    expect(publicInsights(null).enough).toBe(false);
    expect(publicInsights(row()).enough).toBe(true);
  });

  it("buckets skips by second into the hook", () => {
    expect(skipBucket(0)).toBe(0);
    expect(skipBucket(2_999)).toBe(2);
    expect(skipBucket(90_000)).toBe(29);
    expect(skipBucket(-5)).toBe(0);
  });

  it("draws the still-listening curve from the skips", () => {
    const skipAt = emptySkipAt();
    skipAt[1] = 10;
    skipAt[4] = 10;
    expect(stillListening(40, skipAt).slice(0, 6)).toEqual([100, 100, 75, 75, 75, 50]);
  });

  it("finds the second most people leave", () => {
    const skipAt = emptySkipAt();
    skipAt[3] = 9;
    skipAt[7] = 4;
    const out = publicInsights(row({ skipAt }));
    expect(out.enough && out.steepestDrop).toBe(3);
  });

  it("counts a save or 'more like this' toward the save rate", () => {
    const out = publicInsights(row());
    expect(out.enough && out.saveRate).toBe(25);
  });

  it("folds small moods and genres into 'other' so nobody is singled out", () => {
    const out = shares({ party: 20, tender: 2, chill: 6 });
    expect(out.map((s) => s.name)).toEqual(["party", "chill", "other"]);
    expect(out.find((s) => s.name === "tender")).toBeUndefined();
    expect(shares({ party: 3 })).toEqual([]);
  });
});
