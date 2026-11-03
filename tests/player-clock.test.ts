import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPlayerClock } from "../src/audio/playerClock";

/**
 * The playhead used to be React state in usePlayer, so every timeupdate (~4/s)
 * re-rendered App and the whole deck, mid-swipe on a phone. These pin the
 * replacement: a tiny store, and nothing big subscribing to it.
 */
describe("player clock", () => {
  it("notifies on a change, stays quiet when nothing changed", () => {
    const c = createPlayerClock();
    let n = 0;
    const off = c.subscribe(() => n++);
    c.set({ progress: 0.25, remaining: 12 });
    c.set({ progress: 0.25, remaining: 12 });
    expect(n).toBe(1);
    expect(c.get()).toEqual({ progress: 0.25, remaining: 12 });
    c.set({ progress: 0.5 });
    expect(c.get()).toEqual({ progress: 0.5, remaining: 12 });
    expect(n).toBe(2);
    off();
    c.set({ progress: 0.9 });
    expect(n).toBe(2);
  });

  it("starts at the top of a hook with no time-left known", () => {
    expect(createPlayerClock().get()).toEqual({ progress: 0, remaining: Infinity });
  });

  it("the app and the deck read the clock, they don't hold the playhead in state", () => {
    const player = readFileSync(new URL("../src/audio/usePlayer.ts", import.meta.url), "utf8");
    expect(player).not.toMatch(/useState\(0\); \/\/ 0\.\.1/);
    expect(player).not.toMatch(/setProgress|setRemaining/);
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/\bprogress=\{progress\}/);
    expect(app).toMatch(/clock=\{clock\}/);
    const deck = readFileSync(new URL("../src/components/SwipeDeck.tsx", import.meta.url), "utf8");
    // the deck only re-renders when "five seconds left" flips
    expect(deck).toMatch(/useClockSelect\(clock, \(c\) => c\.remaining <= 5 && c\.remaining > 0\)/);
    expect(deck).not.toMatch(/remaining <= 5 && remaining > 0/);
  });
});
