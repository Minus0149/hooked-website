import { describe, expect, it } from "vitest";
import { DECK_PLAYS_PER_SESSION, FEATURED_LABEL, SPONSORED_TAG, deckLabel, deckTracks } from "../src/lib/features";

/**
 * An unpaid pick must never be called promoted, a paid deck must always say
 * who presents it, and a deck must play what it promises first.
 * Mirrored in mobile/src/lib/features.ts.
 */
describe("Home artist features", () => {
  it("label unpaid and paid content differently", () => {
    expect(FEATURED_LABEL).toBe("indie hook of the week");
    expect(FEATURED_LABEL.toLowerCase()).not.toContain("promoted");
    expect(SPONSORED_TAG).toBe("Sponsored");
    expect(deckLabel({ title: "Party deck", brand: "Acme" })).toBe("Party deck · presented by Acme");
  });

  const catalog = [
    { id: "a", genre: "Hip-Hop/Rap" },
    { id: "b", genre: "Pop" },
    { id: "c", genre: "hip hop" },
    { id: "d", genre: "Indie" },
  ];

  it("plays the hand-picked songs first, in order, skipping any not in the catalogue", () => {
    expect(deckTracks(catalog, { trackIds: ["d", "zzz", "b"], genre: null }).map((t) => t.id)).toEqual(["d", "b"]);
  });

  it("fills a genre deck with that genre's songs", () => {
    expect(deckTracks(catalog, { trackIds: ["b"], genre: "hiphop" }).map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("caps what a deck deals and how many plays count", () => {
    expect(deckTracks(catalog, { trackIds: [], genre: "hiphop" }, 1)).toHaveLength(1);
    expect(DECK_PLAYS_PER_SESSION).toBeGreaterThan(0);
  });
});
