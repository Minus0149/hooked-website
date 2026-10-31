import { beforeAll, describe, expect, it } from "vitest";
import type { Track } from "../src/types";

/**
 * The deck must learn DURING a session (31 Oct: saves and skips never reached
 * the deck until a reload, because all ~7,000 songs were ranked once at load).
 * A listener who keeps only one genre should see more of it within 40 swipes.
 */
beforeAll(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage ??= {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
});

const tr = (id: string, genre: string, artist: string): Track =>
  ({ id, title: id, artist, genre, artwork: "", preview: "", hookStart: 10 }) as unknown as Track;

const catalog: Track[] = [
  ...Array.from({ length: 150 }, (_, i) => tr("p" + i, "punjabi pop", "pa" + (i % 50))),
  ...Array.from({ length: 2850 }, (_, i) => tr("o" + i, ["rock", "jazz", "edm", "k-pop", "country"][i % 5], "oa" + (i % 900))),
];

describe("the deck learns within a session", () => {
  it("holds a capped, ranked deck instead of the whole catalogue", async () => {
    const { reducer, initState, DECK_DEPTH } = await import("../src/state/store");
    const s = reducer(initState(), { type: "APPLY_CATALOG", tracks: catalog });
    expect(s.queue.length).toBeLessThanOrEqual(DECK_DEPTH + 1);
  });

  it("deals more of what they keep after 40 swipes", async () => {
    const { reducer, initState } = await import("../src/state/store");
    let before = 0;
    let after = 0;
    for (let trial = 0; trial < 4; trial++) {
      localStorage.removeItem("hooked.library.v2");
      let s = reducer(initState(), { type: "APPLY_CATALOG", tracks: catalog });
      before += s.queue.slice(0, 20).filter((t) => t.genre === "punjabi pop").length;
      for (let i = 0; i < 40; i++) {
        const keep = s.queue[0].genre === "punjabi pop";
        s = reducer(s, { type: "SWIPE", action: keep ? "save" : "skip" });
      }
      after += s.queue.slice(0, 20).filter((t) => t.genre === "punjabi pop").length;
    }
    // 5% of the catalogue; the deck must lift it well past that
    expect(after / 80).toBeGreaterThan(0.2);
    expect(after).toBeGreaterThan(before * 2);
  });

  it("'fresh suggestions' forgets skips and steering and re-deals behind the card on screen", async () => {
    const { reducer, initState } = await import("../src/state/store");
    localStorage.removeItem("hooked.library.v2");
    let s = reducer(initState(), { type: "APPLY_CATALOG", tracks: catalog });
    for (let i = 0; i < 12; i++) s = reducer(s, { type: "SWIPE", action: "skip" });
    const onScreen = s.queue[0].id;
    s = reducer(s, { type: "FRESH_SUGGESTIONS" });
    expect(s.queue[0].id).toBe(onScreen);
    expect(Object.values(s.deckMemory).every((m) => m.skips === 0)).toBe(true);
    expect(s.boostGenres).toEqual([]);
    expect(s.mood).toBeNull();
  });
});
