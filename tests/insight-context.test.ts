import { describe, expect, it } from "vitest";
import { insightContext } from "../src/lib/insightContext";

/** A swipe's position in the hook feeds the artist's drop-off curve. */
describe("insightContext", () => {
  it("turns progress through the hook into milliseconds", () => {
    expect(insightContext(15_000, 0.2, null)).toEqual({ atMs: 3_000 });
  });
  it("adds the mood lens when one is on", () => {
    expect(insightContext(10_000, 0.5, "party")).toEqual({ atMs: 5_000, mood: "party" });
  });
  it("sends nothing it doesn't know", () => {
    expect(insightContext(undefined, 0.5, null)).toEqual({});
    expect(insightContext(10_000, Number.NaN, null)).toEqual({});
    expect(insightContext(Number.POSITIVE_INFINITY, 0.5, null)).toEqual({});
  });
  it("never reports past the end of the hook", () => {
    expect(insightContext(10_000, 1.4, null)).toEqual({ atMs: 10_000 });
  });
});
