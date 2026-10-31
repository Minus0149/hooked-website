import { describe, expect, it } from "vitest";
import { offerReset, SKIP_STREAK, trailingSkips } from "../src/lib/skipStreak";

/** "Not feeling these?" after a run of skips (founder's request, 31 Oct). */
const h = (...a: string[]) => a.map((action) => ({ action }));

describe("trailingSkips", () => {
  it("counts only the skips at the end", () => {
    expect(trailingSkips(h("save", "skip", "skip", "skip"))).toBe(3);
    expect(trailingSkips(h("skip", "skip", "save"))).toBe(0);
    expect(trailingSkips([])).toBe(0);
  });
});

describe("offerReset", () => {
  it("offers at a full run of skips, not before", () => {
    expect(offerReset(SKIP_STREAK - 1, 0)).toBe(false);
    expect(offerReset(SKIP_STREAK, 0)).toBe(true);
  });
  it("after 'keep going', waits for another full run", () => {
    expect(offerReset(SKIP_STREAK + 3, SKIP_STREAK)).toBe(false);
    expect(offerReset(SKIP_STREAK * 2, SKIP_STREAK)).toBe(true);
  });
});
