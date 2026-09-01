import { describe, expect, it } from "vitest";
import { allFeeds, feedSlice } from "../convex/charts";

/**
 * The nightly catalogue pull fails in the quietest way available: a cursor
 * that doesn't advance, or a slice that always returns the same feeds, looks
 * exactly like one that rotates. The job keeps reporting success, and the
 * catalogue simply stops growing past the first storefront's chart. Nothing
 * downstream notices, which is why the arithmetic is checked here.
 */

describe("chart feeds", () => {
  it("covers every storefront and genre once", () => {
    const feeds = allFeeds();
    expect(feeds).toHaveLength(100);
    expect(new Set(feeds.map((f) => f.url)).size).toBe(100);
    expect(new Set(feeds.map((f) => f.country)).size).toBe(10);
  });

  it("leads with India, which is who the deck is built for first", () => {
    expect(allFeeds()[0].country).toBe("in");
  });

  it("asks Apple for a chart, not something else", () => {
    for (const f of allFeeds()) {
      expect(f.url).toMatch(/^https:\/\/itunes\.apple\.com\/[a-z]{2}\/rss\/topsongs\//);
    }
  });
});

describe("the rolling cursor", () => {
  const feeds = Array.from({ length: 100 }, (_, i) => i);

  it("takes the next slice, and takes it in order", () => {
    expect(feedSlice(feeds, 0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(feedSlice(feeds, 10, 3)).toEqual([10, 11, 12]);
  });

  it("wraps past the end rather than running short", () => {
    expect(feedSlice(feeds, 98, 4)).toEqual([98, 99, 0, 1]);
  });

  it("visits every feed exactly once per cycle", () => {
    const seen: number[] = [];
    let cursor = 0;
    for (let run = 0; run < 10; run++) {
      const slice = feedSlice(feeds, cursor, 10);
      seen.push(...slice);
      cursor = (cursor + slice.length) % feeds.length;
    }
    expect(seen).toHaveLength(100);
    expect(new Set(seen).size).toBe(100);
    expect(cursor).toBe(0); // and lands back where it started
  });

  it("survives a cursor that has gone out of range or negative", () => {
    expect(feedSlice(feeds, 250, 2)).toEqual([50, 51]);
    expect(feedSlice(feeds, -1, 2)).toEqual([99, 0]);
  });

  it("never asks for more feeds than exist", () => {
    expect(feedSlice(feeds, 0, 500)).toHaveLength(100);
  });

  it("returns nothing when the job is switched off", () => {
    expect(feedSlice(feeds, 0, 0)).toEqual([]);
    expect(feedSlice([], 0, 10)).toEqual([]);
  });
});
