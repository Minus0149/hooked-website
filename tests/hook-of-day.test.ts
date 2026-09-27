import { describe, expect, it } from "vitest";
import {
  dayKey,
  hookTimeLabel,
  notificationTimes,
  pickForDay,
  planDays,
  pruneHistory,
  type HookPick,
} from "../src/lib/hookOfDay";

/**
 * Hook of the day: one pick per day, stable for that day, never the same song
 * twice within 30 days, measured hooks preferred, and notifications at the
 * listener's time starting today if it hasn't passed.
 */
const c = (id: string, hooked = true) => ({ id, hooks: hooked ? [{}] : [] });

describe("pickForDay", () => {
  it("prefers a song whose hook was measured", () => {
    expect(pickForDay([c("a", false), c("b")], [], "2026-09-27")?.id).toBe("b");
  });

  it("keeps today's pick even if the deck moved", () => {
    const h: HookPick[] = [{ day: "2026-09-27", trackId: "z" }];
    expect(pickForDay([c("a"), c("z")], h, "2026-09-27")?.id).toBe("z");
  });

  it("never repeats a song within 30 days, but may after", () => {
    const h: HookPick[] = [{ day: "2026-09-20", trackId: "a" }];
    expect(pickForDay([c("a"), c("b")], h, "2026-09-27")?.id).toBe("b");
    expect(pickForDay([c("a"), c("b")], h, "2026-10-25")?.id).toBe("a");
  });

  it("skips excluded songs (already in the library)", () => {
    expect(pickForDay([c("a"), c("b")], [], "2026-09-27", new Set(["a"]))?.id).toBe("b");
  });

  it("answers null when there's nothing left", () => {
    expect(pickForDay([], [], "2026-09-27")).toBeNull();
  });
});

describe("planDays", () => {
  it("gives a different song each day and records them", () => {
    const { picks, history } = planDays([c("a"), c("b"), c("c")], [], new Date(2026, 8, 27), 3);
    expect(picks.map((p) => p.day)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29"]);
    expect(new Set(picks.map((p) => p.track.id)).size).toBe(3);
    expect(history).toHaveLength(3);
  });

  it("stops when it runs out of fresh songs rather than repeating", () => {
    const { picks } = planDays([c("a")], [], new Date(2026, 8, 27), 3);
    expect(picks).toHaveLength(1);
  });
});

describe("dates and times", () => {
  it("formats the local day", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("drops history older than the no-repeat window", () => {
    const h: HookPick[] = [
      { day: "2026-08-01", trackId: "old" },
      { day: "2026-09-20", trackId: "new" },
    ];
    expect(pruneHistory(h, "2026-09-27").map((x) => x.trackId)).toEqual(["new"]);
  });

  it("schedules from today if the time is still ahead, else from tomorrow", () => {
    const morning = new Date(2026, 8, 27, 7, 0);
    expect(notificationTimes(morning, 8, 0, 2).map((d) => d.getDate())).toEqual([27, 28]);
    const night = new Date(2026, 8, 27, 21, 0);
    const t = notificationTimes(night, 8, 0, 2);
    expect(t.map((d) => d.getDate())).toEqual([28, 29]);
    expect(t[0].getHours()).toBe(8);
  });
});

describe("hookTimeLabel", () => {
  it("reads as a 12-hour clock in English", () => {
    expect(hookTimeLabel(8, 0)).toBe("8:00 am");
    expect(hookTimeLabel(12, 30)).toBe("12:30 pm");
    expect(hookTimeLabel(20, 0)).toBe("8:00 pm");
    expect(hookTimeLabel(0, 5)).toBe("12:05 am");
  });
  it("names the part of the day in Hindi", () => {
    expect(hookTimeLabel(8, 0, "hi")).toBe("सुबह 8:00");
    expect(hookTimeLabel(12, 30, "hi")).toBe("दोपहर 12:30");
    expect(hookTimeLabel(17, 30, "hi")).toBe("शाम 5:30");
    expect(hookTimeLabel(22, 0, "hi")).toBe("रात 10:00");
  });
});
