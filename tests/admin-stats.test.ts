import { describe, expect, it } from "vitest";
import { swipeAggregates, todayCounts } from "../convex/admin";

const swipe = (action: "skip" | "save" | "more" | "never", trackId: string, genre = "pop", artist = `artist-${trackId}`) => ({
  action,
  trackId,
  title: `Track ${trackId}`,
  artist,
  artwork: "",
  genre,
});

describe("the Overview's leaderboards", () => {
  const swipes = [
    swipe("skip", "a"), swipe("skip", "a"), swipe("skip", "a"), swipe("skip", "a"),
    swipe("save", "b"), swipe("save", "b"),
    swipe("save", "c", "rock"),
    swipe("never", "d", "rock", "Loud Band"), swipe("never", "e", "rock", "Loud Band"),
  ];
  const agg = swipeAggregates(swipes);

  it("ranks top saved by saves, not by how often a track was swiped at all", () => {
    // 'a' was swiped four times and never saved — it used to top this list
    expect(agg.topSaved.map((t) => t.trackId)).toEqual(["b", "c"]);
    expect(agg.topSaved[0].count).toBe(2);
  });

  it("counts saves per genre instead of reporting 0% everywhere", () => {
    expect(agg.genres.find((g) => g.genre === "pop")).toEqual({ genre: "pop", total: 6, saves: 2 });
    expect(agg.genres.find((g) => g.genre === "rock")).toEqual({ genre: "rock", total: 3, saves: 1 });
  });

  it("lists the artists people blocked", () => {
    expect(agg.topNever).toEqual([{ artist: "Loud Band", count: 2 }]);
  });
});

describe("today's counts", () => {
  const today = "2026-09-23";
  const at = (iso: string) => Date.parse(iso);
  const rolled = { saves: 10, skips: 20, mores: 1, nevers: 2 };

  it("adds only swipes the rollup hasn't counted yet", () => {
    const wm = at("2026-09-23T10:00:00Z");
    const tail = [
      { action: "save" as const, _creationTime: at("2026-09-23T09:00:00Z") }, // already rolled
      { action: "save" as const, _creationTime: at("2026-09-23T11:00:00Z") }, // pending
    ];
    expect(todayCounts(rolled, tail, wm, today).save).toBe(11);
  });

  it("leaves yesterday's late swipes out of today", () => {
    const tail = [{ action: "skip" as const, _creationTime: at("2026-09-22T23:30:00Z") }];
    expect(todayCounts(rolled, tail, 0, today).skip).toBe(20);
  });

  it("works before the first rollup has written a row", () => {
    const tail = [{ action: "never" as const, _creationTime: at("2026-09-23T08:00:00Z") }];
    expect(todayCounts(undefined, tail, 0, today)).toEqual({ save: 0, skip: 0, more: 0, never: 1 });
  });
});
