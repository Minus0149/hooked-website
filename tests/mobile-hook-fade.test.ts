import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HAS_MOBILE } from "./mobile-sibling";

/**
 * hookGain was mirrored into the phone app on 27 Oct, but its player never
 * called it: phones stopped dead at the line's end. The phone's player now
 * follows windowVolume (hookGain with the listener's volume as the ceiling)
 * on a 40 ms timer and on every status event.
 */
const MOBILE_LIB = new URL("../../mobile/src/lib/hooks.ts", import.meta.url).href;
const { windowVolume, FADE_TICK_MS } = HAS_MOBILE
  ? ((await import(/* @vite-ignore */ MOBILE_LIB)) as typeof import("../../mobile/src/lib/hooks"))
  : { windowVolume: () => 0, FADE_TICK_MS: 0 };

// a hook at 12 s that runs 15 s, in a 30 s preview
const hook = { id: "h", startMs: 12_000, durationMs: 15_000 };

describe.skipIf(!HAS_MOBILE)("the phone's hook fade", () => {
  it("is silent before the seek to the hook lands, then fades in", () => {
    expect(windowVolume(hook, 0, 30, 1)).toBe(0);
    expect(windowVolume(hook, 12, 30, 1)).toBe(0);
    expect(windowVolume(hook, 12.06, 30, 1)).toBeCloseTo(0.5);
    expect(windowVolume(hook, 20, 30, 1)).toBe(1);
  });

  it("fades out over the last half second and is silent at the window's end", () => {
    expect(windowVolume(hook, 26.5, 30, 1)).toBe(1);
    expect(windowVolume(hook, 26.75, 30, 1)).toBeCloseTo(0.5);
    expect(windowVolume(hook, 27, 30, 1)).toBe(0);
  });

  it("keeps the listener's volume as the ceiling", () => {
    expect(windowVolume(hook, 20, 30, 0.4)).toBeCloseTo(0.4);
    expect(windowVolume(hook, 26.75, 30, 0.4)).toBeCloseTo(0.2);
    expect(windowVolume(hook, 20, 30, Number.NaN)).toBe(1);
  });

  it("only fades in when the song plays on past the window (Auto-advance off)", () => {
    expect(windowVolume(hook, 26.75, 30, 1, false)).toBe(1);
    expect(windowVolume(hook, 29, 30, 1, false)).toBe(1);
  });

  it("the open-ended fallback fades out at the end of the file", () => {
    const whole = { id: "whole", startMs: 0, durationMs: Number.POSITIVE_INFINITY };
    expect(windowVolume(whole, 15, 30, 1)).toBe(1);
    expect(windowVolume(whole, 29.75, 30, 1)).toBeCloseTo(0.5);
  });

  it("the player actually applies it, fast enough for a half-second fade", () => {
    const app = readFileSync("../mobile/App.tsx", "utf8");
    expect(app).toMatch(/player\.volume = windowVolume\(hook, player\.currentTime, player\.duration, volumeRef\.current, endsHere\)/);
    expect(app).toMatch(/setInterval\(applyFade, FADE_TICK_MS\)/);
    // background playback: timers pause, status events don't
    expect(app).toMatch(/if \(inDiscover\) applyFade\(\);\s*\}, \[status\.currentTime/);
    expect(FADE_TICK_MS).toBeLessThanOrEqual(50);
  });
});
