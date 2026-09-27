import { describe, expect, it } from "vitest";
import { detectLang, HI, HI_REVIEW, placeholders, translate } from "../src/lib/i18n";

/**
 * Hindi. A missing translation must fall back to English (never a key or a
 * blank), every Hindi string must use exactly the placeholders its English
 * source does, and the brand name stays "hookedcue".
 */
describe("i18n", () => {
  it("detects Hindi from the device or browser", () => {
    expect(detectLang(["hi-IN", "en-US"])).toBe("hi");
    expect(detectLang("en-IN")).toBe("en");
    expect(detectLang(undefined)).toBe("en");
  });

  it("falls back to English for anything untranslated", () => {
    expect(translate("hi", "A sentence nobody translated")).toBe("A sentence nobody translated");
    expect(translate("en", "Play")).toBe("Play");
    expect(translate("hi", "Play")).toBe(HI.Play);
  });

  it("fills placeholders in both languages", () => {
    expect(translate("en", "{n} songs", { n: 3 })).toBe("3 songs");
    expect(translate("hi", "{n} songs", { n: 3 })).toContain("3");
  });

  it("uses the same placeholders in every Hindi string as in its English source", () => {
    const bad = Object.entries(HI).filter(
      ([en, hi]) => placeholders(en).join(",") !== placeholders(hi).join(","),
    );
    expect(bad).toEqual([]);
  });

  it("has no empty translations, and keeps the brand name", () => {
    expect(Object.entries(HI).filter(([, hi]) => !hi.trim())).toEqual([]);
    for (const [en, hi] of Object.entries(HI)) {
      if (en.includes("hookedcue")) expect(hi).toContain("hookedcue");
    }
  });

  it("only flags strings that exist for review", () => {
    expect(HI_REVIEW.filter((k) => !(k in HI))).toEqual([]);
  });
});
