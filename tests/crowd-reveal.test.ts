import { describe, expect, it } from "vitest";
import { crowdReveal, MIN_CROWD, nextStreak, verdictOf } from "../src/lib/crowdReveal";
import { sumStats } from "../convex/verdicts";

/** After a save or skip: how everyone else judged the song, and a with-the-crowd streak (31 Oct). */
describe("crowdReveal", () => {
  it("says you're among the first when too few others have judged it", () => {
    expect(crowdReveal({ listeners: 2, saves: 1, skips: 1 }, "save")).toEqual({ kind: "first", mine: "save" });
    expect(crowdReveal(null, "skip").kind).toBe("first");
  });

  it("shows the split and whether you went with the crowd", () => {
    const r = crowdReveal({ listeners: 10, saves: 7, skips: 3 }, "save");
    expect(r).toMatchObject({ kind: "crowd", savePct: 70, skipPct: 30, withCrowd: true, others: 10 });
    expect(crowdReveal({ listeners: 10, saves: 7, skips: 3 }, "skip")).toMatchObject({ withCrowd: false });
  });

  it("a dead heat counts as with the crowd", () => {
    expect(crowdReveal({ listeners: 4, saves: 2, skips: 2 }, "skip")).toMatchObject({ withCrowd: true, savePct: 50 });
  });

  it("needs MIN_CROWD decided votes, not just plays", () => {
    expect(crowdReveal({ listeners: 50, saves: 1, skips: MIN_CROWD - 2 }, "save").kind).toBe("first");
  });
});

describe("streak and verdicts", () => {
  it("grows with the crowd, resets against it, holds when there's no crowd", () => {
    const withIt = crowdReveal({ listeners: 9, saves: 6, skips: 3 }, "save");
    const against = crowdReveal({ listeners: 9, saves: 6, skips: 3 }, "skip");
    expect(nextStreak(2, withIt)).toBe(3);
    expect(nextStreak(2, against)).toBe(0);
    expect(nextStreak(2, crowdReveal(null, "save"))).toBe(2);
  });

  it("maps swipe actions to verdicts", () => {
    expect(verdictOf("save")).toBe("save");
    expect(verdictOf("more")).toBe("save");
    expect(verdictOf("skip")).toBe("skip");
    expect(verdictOf("never")).toBe("skip");
    expect(verdictOf("back")).toBeNull();
  });

  it("sums a song's hooks", () => {
    expect(sumStats([{ plays: 3, saves: 1, skips: 2 }, { plays: 5, saves: 4, skips: 1 }])).toEqual({ listeners: 8, saves: 5, skips: 3 });
  });
});
