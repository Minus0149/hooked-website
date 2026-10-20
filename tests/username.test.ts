import { describe, expect, it } from "vitest";
import { normalizeUsername, usernameProblem, USERNAME_MAX } from "../src/lib/username";

/** @handles: one rule set for the server and both apps (Minus, 2026-10-20). */
describe("usernames", () => {
  it("stores what was typed without the @, spaces or capitals", () => {
    expect(normalizeUsername("  @Minus_0149 ")).toBe("minus_0149");
  });

  it("accepts the usual shapes", () => {
    for (const ok of ["minus", "minus.4399", "dj_raj", "a1b", "x".repeat(USERNAME_MAX)]) {
      expect(usernameProblem(ok), ok).toBeNull();
    }
  });

  it("refuses names that are too short, too long or oddly made", () => {
    expect(usernameProblem("ab")).toMatch(/at least/i);
    expect(usernameProblem("x".repeat(USERNAME_MAX + 1))).toMatch(/at most/i);
    expect(usernameProblem("has space")).toMatch(/only letters/i);
    expect(usernameProblem("emoji🎵")).toMatch(/only letters/i);
    expect(usernameProblem(".minus")).toMatch(/start and end/i);
    expect(usernameProblem("minus_")).toMatch(/start and end/i);
    expect(usernameProblem("mi..nus")).toMatch(/two dots/i);
    expect(usernameProblem("12345")).toMatch(/one letter/i);
  });

  it("keeps the app's own names and staff-sounding names for the app", () => {
    for (const bad of ["admin", "support", "hookedcue", "real.hookedcue", "hookedcue_official", "search", "settings"]) {
      expect(usernameProblem(bad), bad).toMatch(/reserved/i);
    }
  });
});
