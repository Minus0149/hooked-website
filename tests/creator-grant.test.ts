import { describe, expect, it } from "vitest";
import { creatorNameFor } from "../convex/creators";

/**
 * creators:grant is run by hand from the command line, so the name it files a
 * creator under has to be sensible whatever was (or wasn't) typed.
 */
describe("creatorNameFor", () => {
  it("keeps the name that was asked for", () => {
    expect(creatorNameFor("hookedcue review", "hello@hookedcue.com")).toBe("hookedcue review");
  });

  it("falls back to the address when no name is given", () => {
    expect(creatorNameFor(undefined, "hello@hookedcue.com")).toBe("hello");
    expect(creatorNameFor(" ", "hello@hookedcue.com")).toBe("hello");
  });

  it("never files a one-letter name", () => {
    expect(creatorNameFor("x", "a@b.co")).toBe("creator");
  });
});
