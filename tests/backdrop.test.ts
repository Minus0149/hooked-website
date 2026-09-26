import { describe, expect, it } from "vitest";
import { intensityForPx, tintOver } from "../src/lib/backdrop";

/**
 * The phone's frosted backdrop (mood wheel, sheets) has to look like the web's
 * `rgba(3,3,5,a) + blur(Npx)`. It stacks expo-blur's dark tint under its own,
 * so these check the pair adds up to the web's darkness rather than past it.
 */
describe("backdrop maths", () => {
  it("maps the web's blur radius onto expo-blur intensity", () => {
    expect(intensityForPx(10)).toBe(50); // the mood wheel
    expect(intensityForPx(3)).toBe(15); // sheets
    expect(intensityForPx(40)).toBe(100);
  });

  it("stacks to exactly the web's darkness", () => {
    for (const [px, dim] of [[10, 0.72], [3, 0.6]] as const) {
      const i = intensityForPx(px);
      const blurAlpha = (i / 100) * 0.78;
      const total = 1 - (1 - blurAlpha) * (1 - tintOver(dim, i));
      expect(total).toBeCloseTo(dim, 6);
    }
  });

  it("is the plain dim when there is no blur", () => {
    expect(tintOver(0.72, 0)).toBeCloseTo(0.72, 6);
  });

  it("never asks for a negative or over-full tint", () => {
    expect(tintOver(0.1, 100)).toBe(0);
    expect(tintOver(1, 50)).toBe(1);
  });
});
