import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * On Android the + and the notch's shoulders were sliced off flat (Minus,
 * 2026-09-28: "the bottom + is being cut off"). The screen sits in expo-blur's
 * BlurTargetView, a FrameLayout that clips each child to its bounds, so
 * whatever rises above the bar must lie inside the dock's own bounds.
 */
const src = readFileSync("../mobile/src/components/BottomNav.tsx", "utf8");
const num = (name: string) => Number(new RegExp(`const ${name} = ([0-9]+)`).exec(src)?.[1]);

describe("the phone's bottom nav", () => {
  it("keeps room above the bar for everything that rises out of it", () => {
    const extra = /export const DOCK_ROOM = RISE \+ (\d+);/.exec(src);
    expect(extra).not.toBeNull();
    const room = num("RISE") + Number(extra![1]);
    expect(room).toBeGreaterThanOrEqual(num("RISE"));
    expect(room).toBeGreaterThanOrEqual(num("OVER"));
    expect(src).toMatch(/paddingTop: DOCK_ROOM/);
    expect(src).toMatch(/marginTop: 6 - DOCK_ROOM/);
    expect(src).toMatch(/top: -RISE/);
  });

  it("is a real view that lets touches through its empty room", () => {
    expect(src).toMatch(/<View style=\{styles\.dock\} collapsable=\{false\} pointerEvents="box-none">/);
  });
});
