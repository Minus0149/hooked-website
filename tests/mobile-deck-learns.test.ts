import { describe, expect, it } from "vitest";
import type { Track } from "../src/types";
import { HAS_MOBILE } from "./mobile-sibling";

/**
 * The phone's deck learns during a session too (web 8e50157, ported for v8):
 * a capped deck, re-ranked from the whole catalogue with what was just saved
 * and skipped, and "Fresh suggestions" for the "Not feeling these?" prompt.
 * Same simulation as deck-learns.test.ts, against the phone's own reducer.
 */
const MOBILE_STORE = new URL("../../mobile/src/state/store.tsx", import.meta.url).href;
type Store = typeof import("../../mobile/src/state/store");
const load = async (): Promise<Store> => (await import(/* @vite-ignore */ MOBILE_STORE)) as Store;

const tr = (id: string, genre: string, artist: string): Track =>
  ({ id, title: id, artist, genre, artwork: "", preview: "", hookStart: 10 }) as unknown as Track;

const catalog: Track[] = [
  ...Array.from({ length: 150 }, (_, i) => tr("p" + i, "punjabi pop", "pa" + (i % 50))),
  ...Array.from({ length: 2850 }, (_, i) => tr("o" + i, ["rock", "jazz", "edm", "k-pop", "country"][i % 5], "oa" + (i % 900))),
];

/** A fresh install: the empty local read, then the server catalogue. */
async function fresh() {
  const { reducer, initialState } = await load();
  const hydrated = reducer(initialState, { type: "HYDRATE", payload: {} });
  return reducer(hydrated, { type: "APPLY_CATALOG", tracks: catalog });
}

describe.skipIf(!HAS_MOBILE)("the phone's deck learns within a session", () => {
  it("holds a capped, ranked deck instead of the whole catalogue", async () => {
    const { DECK_DEPTH } = await load();
    const s = await fresh();
    expect(s.queue.length).toBeLessThanOrEqual(DECK_DEPTH + 1);
    expect(s.queue.length).toBeGreaterThan(10);
  });

  it("deals more of what they keep after 40 swipes", async () => {
    const { reducer } = await load();
    let before = 0;
    let after = 0;
    for (let trial = 0; trial < 4; trial++) {
      let s = await fresh();
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

  it("a save nudges its genre; a right-swipe re-deals at once, keeping the peek card", async () => {
    const { reducer } = await load();
    let s = await fresh();
    const saved = s.queue[0];
    s = reducer(s, { type: "SWIPE", action: "save" });
    expect(s.boostGenres[0]).toBe(saved.genre);

    const peek = s.queue[1];
    const liked = s.queue[0];
    s = reducer(s, { type: "SWIPE", action: "more" });
    expect(s.queue[0].id).toBe(peek.id);
    expect(s.boostGenres[0]).toBe(liked.genre);
  });

  it("keeps buried songs and last week's cards out when the catalogue reloads", async () => {
    const { reducer } = await load();
    let s = await fresh();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(s.queue[0].id);
      s = reducer(s, { type: "SWIPE", action: "skip" });
    }
    const buried = s.queue[0];
    s = reducer(s, { type: "SWIPE", action: "never" });
    // a different catalogue array (same songs) makes APPLY_CATALOG rebuild
    s = reducer(s, { type: "APPLY_CATALOG", tracks: [...catalog].reverse() });
    const ids = s.queue.slice(1).map((t) => t.id);
    expect(ids).not.toContain(buried.id);
    for (const id of seen) expect(ids).not.toContain(id);
  });

  it("a mood draws from the whole catalogue, then caps the deck", async () => {
    const { reducer, DECK_DEPTH } = await load();
    let s = await fresh();
    // the 60 dealt cards hold ~11 rock songs; "hyped" (rock among its genres)
    // can only fill the top 20 with rock by reaching past them
    const dealtRock = s.queue.filter((t) => t.genre === "rock").length;
    expect(dealtRock).toBeLessThan(20);
    s = reducer(s, { type: "SET_MOOD", mood: "hyped" });
    expect(s.mood).toBe("hyped");
    expect(s.queue.length).toBeLessThanOrEqual(DECK_DEPTH);
    expect(s.queue.slice(0, 20).filter((t) => t.genre === "rock").length).toBeGreaterThan(Math.max(dealtRock, 15));
  });

  it("'fresh suggestions' forgets skips and steering and re-deals behind the card on screen", async () => {
    const { reducer } = await load();
    let s = await fresh();
    for (let i = 0; i < 12; i++) s = reducer(s, { type: "SWIPE", action: "skip" });
    s = reducer(s, { type: "SWIPE", action: "more" });
    const onScreen = s.queue[0].id;
    s = reducer(s, { type: "FRESH_SUGGESTIONS" });
    expect(s.queue[0].id).toBe(onScreen);
    expect(Object.values(s.deckMemory).every((m) => m.skips === 0)).toBe(true);
    expect(s.boostGenres).toEqual([]);
    expect(s.mood).toBeNull();
  });
});
