import { describe, expect, it } from "vitest";
import { planHeat } from "../convex/hooks";

/**
 * The heat job runs every hour on every deployment. Its cost has to follow
 * what was played, not the size of the catalogue: when it read all ~2k tracks
 * hourly it was enough on its own to approach the free plan's bandwidth.
 */
describe("planHeat", () => {
  it("touches nothing when nothing has played and nothing is hot", () => {
    expect(planHeat(new Map(), []).size).toBe(0);
  });

  it("scales plays against the most-played track", () => {
    const next = planHeat(new Map([["a", 40], ["b", 10]]), []);
    expect(next.get("a")).toBe(1);
    expect(next.get("b")).toBe(0.25);
  });

  it("cools a track that is hot but has no plays any more", () => {
    const next = planHeat(new Map([["a", 5]]), [{ trackId: "z", heat: 0.7 }, { trackId: "a", heat: 1 }]);
    expect(next.get("z")).toBe(0);
    expect(next.get("a")).toBe(1);
    expect(next.size).toBe(2);
  });
});
