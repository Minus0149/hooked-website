import { describe, expect, it } from "vitest";
import { contrast, inkOn, INK, luminance, PAPER } from "../src/lib/contrast";

describe("text on an accent", () => {
  it("puts dark text on light accents", () => {
    for (const light of ["#FFB627", "#00E5A0", "#FFD23F", "#00C2FF", "#F4F2EE"]) {
      expect(inkOn(light)).toBe(INK);
    }
  });

  it("puts white text on deep accents", () => {
    for (const deep of ["#4C1D95", "#5B21B6", "#1C1C26", "#B00040"]) {
      expect(inkOn(deep)).toBe(PAPER);
    }
  });

  it("always picks the side with the higher contrast", () => {
    for (const c of ["#FF3D71", "#FF6B35", "#E040FB", "#4FD1C5", "#8B7CFF"]) {
      const l = luminance(c)!;
      const chosen = inkOn(c) === INK ? contrast(l, luminance(INK)!) : contrast(l, 1);
      const other = inkOn(c) === INK ? contrast(l, 1) : contrast(l, luminance(INK)!);
      expect(chosen).toBeGreaterThanOrEqual(other);
    }
  });

  it("reads short hex and falls back to white for anything else", () => {
    expect(luminance("#fff")).toBeCloseTo(1);
    expect(inkOn("not a colour")).toBe(PAPER);
  });
});
