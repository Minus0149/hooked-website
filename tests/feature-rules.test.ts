import { describe, expect, it } from "vitest";
import { deckCsv, deckLabel, deckLive, isWeekKey, weekOf } from "../convex/featureRules";

/**
 * The indie hook of the week changes every Monday in India, and a sponsored
 * deck must always say who presents it and report counts a sponsor can open
 * in a spreadsheet.
 */
describe("indie hook of the week", () => {
  it("weeks start on Monday, India time", () => {
    // Sunday 27 Sep 2026, 23:00 IST is still the week of Monday 21 Sep
    expect(weekOf(Date.UTC(2026, 8, 27, 17, 30))).toBe("2026-09-21");
    // Monday 28 Sep 00:30 IST starts a new week, though it is still Sunday in UTC
    expect(weekOf(Date.UTC(2026, 8, 27, 19, 0))).toBe("2026-09-28");
    expect(weekOf(Date.UTC(2026, 9, 1, 12, 0))).toBe("2026-09-28");
  });

  it("only accepts a real Monday as a week", () => {
    expect(isWeekKey("2026-09-28")).toBe(true);
    expect(isWeekKey("2026-09-29")).toBe(false);
    expect(isWeekKey("2026-02-30")).toBe(false);
    expect(isWeekKey("next week")).toBe(false);
  });
});

describe("sponsored mood decks", () => {
  const deck = { active: true, startsAt: 1_000, endsAt: 2_000 };

  it("are live only while switched on and inside their dates", () => {
    expect(deckLive(deck, 1_500)).toBe(true);
    expect(deckLive(deck, 2_000)).toBe(false);
    expect(deckLive(deck, 999)).toBe(false);
    expect(deckLive({ ...deck, active: false }, 1_500)).toBe(false);
  });

  it("always name the sponsor", () => {
    expect(deckLabel({ title: "Party deck", brand: "Acme" })).toBe("Party deck · presented by Acme");
  });

  it("export a sponsor report with a total, safely quoted", () => {
    const csv = deckCsv({ brand: 'Acme, "Inc"', title: "Party deck" }, [
      { day: "2026-10-02", impressions: 10, opens: 3, plays: 9 },
      { day: "2026-10-01", impressions: 5, opens: 1, plays: 2 },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("brand,deck,day,impressions,opens,plays");
    expect(lines[1]).toBe('"Acme, ""Inc""",Party deck,2026-10-01,5,1,2');
    expect(lines[3]).toBe('"Acme, ""Inc""",Party deck,total,15,4,11');
  });
});
