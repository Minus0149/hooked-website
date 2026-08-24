import { describe, expect, it } from "vitest";
import { pairHash, similarity } from "../src/lib/audio-fp";
import { coercePrefs, DEFAULT_PREFS } from "../src/data/prefs";
import { tasteScore } from "../src/data/taste";

describe("audio fingerprint hashing", () => {
  it("pairHash stays inside uint32 and is stable", () => {
    const h = pairHash(15, 3, 47, 8);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    // determinism matters: stored fingerprints must match future ones
    expect(h).toBe(pairHash(15, 3, 47, 8));
  });

  it("different pairs hash differently", () => {
    expect(pairHash(1, 2, 3, 4)).not.toBe(pairHash(2, 1, 3, 4));
  });

  it("similarity is relative to the smaller set", () => {
    expect(similarity([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(similarity([1, 2, 3], [4, 5, 6])).toBe(0);
    // a long query against a tiny target can't exceed full coverage of the target
    expect(similarity([1, 2, 3, 4, 5], [1, 99])).toBeCloseTo(0.5);
  });
});

describe("prefs coercion", () => {
  it("keeps valid values and defaults the rest", () => {
    const p = coercePrefs({
      motion: "reduced",
      accentColor: "#00e5a0",
      swipeSensitivity: 9,
      adsOptOut: true,
    });
    expect(p.motion).toBe("reduced");
    expect(p.accentColor).toBe("#00E5A0");
    expect(p.swipeSensitivity).toBe(DEFAULT_PREFS.swipeSensitivity); // clamped back
    expect(p.adsOptOut).toBe(true);
  });

  it("never trusts a hand-edited row", () => {
    const evil = coercePrefs({
      motion: "EXPLOIT",
      haptics: "<script>",
      accentColor: "javascript:alert(1)",
      swipeSensitivity: -5,
    });
    expect(evil.motion).toBe(DEFAULT_PREFS.motion);
    expect(evil.haptics).toBe(DEFAULT_PREFS.haptics);
    expect(evil.accentColor).toBe(DEFAULT_PREFS.accentColor);
    expect(evil.swipeSensitivity).toBe(DEFAULT_PREFS.swipeSensitivity);
  });
});

describe("tasteScore heat handling", () => {
  const base = { languages: [], genres: [], adventure: "hits" as const };

  it("the adventure answer rewards known songs for hits-seekers", () => {
    const cold = tasteScore({ genre: "pop" }, base);
    const hot = tasteScore({ genre: "pop", heat: 1 }, base);
    expect(hot).toBeGreaterThan(cold);
  });

  it("and buries them for deep-seekers", () => {
    const deep = { ...base, adventure: "deep" as const };
    const hot = tasteScore({ genre: "pop", heat: 1 }, deep);
    const cold = tasteScore({ genre: "pop", heat: 0 }, deep);
    expect(cold).toBeGreaterThan(hot);
  });
});
