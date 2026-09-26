import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVERY_N_CARDS,
  PROMOTED_LABEL,
  insertPromoted,
  promotedDue,
  promotedOutcome,
} from "../src/lib/promoted";

/**
 * A promoted song is paid content inside the deck. It must be labelled, must
 * never interrupt the song someone is listening to, must respect people who
 * turned sponsored cards off, and its swipes must be reported to the artist as
 * what they were. Mirrored in mobile/src/lib/promoted.ts.
 */
describe("promoted songs in the deck", () => {
  it("are labelled as promoted", () => {
    expect(PROMOTED_LABEL).toBe("Promoted");
  });

  it("go next in line, behind the card on screen, once", () => {
    const q = [{ id: "a" }, { id: "b" }, { id: "p" }, { id: "c" }];
    expect(insertPromoted(q, { id: "p" }).map((t) => t.id)).toEqual(["a", "p", "b", "c"]);
    expect(insertPromoted([{ id: "p" }, { id: "b" }], { id: "p" }).map((t) => t.id)).toEqual(["p", "b"]);
    expect(insertPromoted([], { id: "p" }).map((t) => t.id)).toEqual(["p"]);
  });

  it("are asked for every N swipes, and never after opting out", () => {
    expect(promotedDue({ swipesSince: DEFAULT_EVERY_N_CARDS - 1, everyNCards: DEFAULT_EVERY_N_CARDS, optedOut: false })).toBe(false);
    expect(promotedDue({ swipesSince: DEFAULT_EVERY_N_CARDS, everyNCards: DEFAULT_EVERY_N_CARDS, optedOut: false })).toBe(true);
    expect(promotedDue({ swipesSince: 99, everyNCards: 10, optedOut: true })).toBe(false);
    // a mis-set config can't turn every other card into an ad
    expect(promotedDue({ swipesSince: 2, everyNCards: 1, optedOut: false })).toBe(false);
  });

  it("report each swipe as the artist would read it", () => {
    expect(promotedOutcome("down")).toBe("save");
    expect(promotedOutcome("up")).toBe("skip");
    expect(promotedOutcome("right")).toBe("more");
    expect(promotedOutcome("left")).toBe("never");
  });
});
