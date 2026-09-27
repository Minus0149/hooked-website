import { describe, expect, it } from "vitest";
import { genresOverlap, pickCampaign, targetMatches, TARGETING_SLACK } from "../convex/promotionRules";

/**
 * An artist can aim a promotion at moods and genres. Delivery should prefer
 * listeners who fit, never break the mood someone picked, and still deliver
 * what was paid for when the fitting audience is too small.
 */
describe("promotion targeting", () => {
  const partyLover = { mood: "party", genres: ["hiphop", "punjabi"] };
  const noLens = { mood: null, genres: ["indie"] };

  it("treats genre spellings as the same genre", () => {
    expect(genresOverlap(["Hip-Hop/Rap"], ["hiphop"])).toBe(true);
    expect(genresOverlap(["indie"], ["Indie Pop"])).toBe(true);
    expect(genresOverlap(["jazz"], ["hiphop"])).toBe(false);
  });

  it("matches listeners in the targeted mood or genre", () => {
    expect(targetMatches({ moods: ["party"], genres: [] }, partyLover, true)).toBe(true);
    expect(targetMatches({ moods: [], genres: ["hip-hop"] }, partyLover, true)).toBe(true);
    expect(targetMatches({ moods: ["tender"], genres: [] }, partyLover, true)).toBe(false);
    expect(targetMatches({ moods: ["party"], genres: [] }, noLens, true)).toBe(false);
    expect(targetMatches({ moods: [], genres: ["indie"] }, noLens, true)).toBe(true);
  });

  it("never deals a song that doesn't fit the listener's mood lens", () => {
    expect(targetMatches(undefined, partyLover, false)).toBe(false);
    expect(targetMatches({ moods: ["party"], genres: [] }, partyLover, false)).toBe(false);
    expect(targetMatches(undefined, noLens, false)).toBe(true); // no lens, nothing to break
  });

  it("prefers matching campaigns, furthest behind first", () => {
    const pick = pickCampaign([
      { item: "a", behind: 0.3, matches: false },
      { item: "b", behind: 0.05, matches: true },
      { item: "c", behind: 0.2, matches: true },
    ]);
    expect(pick).toBe("c");
  });

  it("falls back to anyone only when a campaign is starving", () => {
    expect(pickCampaign([{ item: "a", behind: TARGETING_SLACK / 2, matches: false }])).toBeNull();
    expect(pickCampaign([{ item: "a", behind: TARGETING_SLACK + 0.01, matches: false }])).toBe("a");
    expect(pickCampaign([])).toBeNull();
  });

  it("never falls back to a song that doesn't fit the listener's mood lens", () => {
    // far behind schedule, but the listener is in a mood the song doesn't fit
    expect(pickCampaign([{ item: "a", behind: 0.9, matches: false, fitsLens: false }])).toBeNull();
    expect(pickCampaign([
      { item: "a", behind: 0.9, matches: false, fitsLens: false },
      { item: "b", behind: 0.2, matches: false, fitsLens: true },
    ])).toBe("b");
  });
});
