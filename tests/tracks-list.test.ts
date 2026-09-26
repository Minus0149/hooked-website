import { describe, expect, it } from "vitest";
import { hooksByTrack } from "../convex/tracks";

/**
 * tracks.list used to run one hooks query per track (2,573 on the live
 * catalogue) and could take minutes after any catalogue change, stalling every
 * client. It now reads the active hooks once and groups them; the grouping
 * must give each track exactly its own hooks, best first.
 */
describe("hooksByTrack", () => {
  const h = (trackId: string, order: number, rank?: number) => ({ trackId, order, rank, id: `${trackId}-${order}` });

  it("gives each track only its own hooks", () => {
    const by = hooksByTrack([h("a", 0), h("b", 0), h("a", 1)]);
    expect(by.get("a")?.map((x) => x.id)).toEqual(["a-0", "a-1"]);
    expect(by.get("b")?.map((x) => x.id)).toEqual(["b-0"]);
    expect(by.get("c")).toBeUndefined();
  });

  it("puts the best-ranked hook first, the creator's order breaking ties and standing in for no rank", () => {
    const by = hooksByTrack([h("a", 0, 2), h("a", 1, 0), h("a", 2)]);
    // keys: a-0 rank 2, a-1 rank 0, a-2 unranked so its order (2) — a tie with a-0, broken by order
    expect(by.get("a")?.map((x) => x.id)).toEqual(["a-1", "a-0", "a-2"]);
  });
});
