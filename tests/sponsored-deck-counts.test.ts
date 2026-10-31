import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DECK_EVENT_DAILY, deckCountsFor } from "../convex/featureRules";

/**
 * A sponsor's report counted any anonymous install key, and keys are free to
 * mint: a script with a fresh key per call padded impressions, opens and plays
 * at will. Now only signed-in, active, non-staff accounts count, a few times a
 * day per deck each (the same rule recordPromoted got in a25d0e6).
 */
describe("who a sponsored deck counts", () => {
  it("an active listener counts; no account, a suspended one, or deck staff don't", () => {
    expect(deckCountsFor({ isAdmin: false, permissions: [] })).toBe(true);
    expect(deckCountsFor(null)).toBe(false);
    expect(deckCountsFor({ suspended: true })).toBe(false);
    expect(deckCountsFor({ isAdmin: true })).toBe(false);
    expect(deckCountsFor({ permissions: ["ads.manage"] })).toBe(false);
    expect(deckCountsFor({ permissions: ["stats.view"] })).toBe(true);
  });

  it("one account counts once a day per deck for an impression", () => {
    expect(DECK_EVENT_DAILY.impression).toBe(1);
    expect(DECK_EVENT_DAILY.open).toBeLessThanOrEqual(5);
    expect(DECK_EVENT_DAILY.play).toBeLessThanOrEqual(60);
  });

  it("record never reads the anonymous key, and checks the account before counting", () => {
    const src = readFileSync(resolve(__dirname, "..", "convex", "sponsoredDecks.ts"), "utf8");
    const record = src.slice(src.indexOf("export const record = "), src.indexOf("export const adminList"));
    const handler = record.slice(record.indexOf("handler:"));
    expect(handler).not.toMatch(/anonKey/);
    expect(handler).not.toMatch(/getUserIdentity/);
    expect(handler.indexOf("deckCountsFor(")).toBeGreaterThan(0);
    expect(handler.indexOf("deckCountsFor(")).toBeLessThan(handler.indexOf('insert("sponsoredDeckStats"'));
    expect(handler).toMatch(/deck:day:\$\{event\}:\$\{deckId\}:\$\{who\}`, DECK_EVENT_DAILY\[event\]/);
    // older app builds still send it, so the argument stays
    expect(record).toMatch(/anonKey: v\.optional\(v\.string\(\)\)/);
  });
});
