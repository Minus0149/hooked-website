import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicName } from "../convex/socialRules";

describe("publicName: what other listeners see", () => {
  it("never shows the email's local part, which sign-up fills in as the name", () => {
    expect(publicName({ name: "hc-audit-a", email: "hc-audit-a@example.com", username: "hcaudita" })).toBe("@hcaudita");
    expect(publicName({ name: "Subhash2004KA", email: "subhash2004ka@gmail.com", username: null })).toBe("Someone");
    expect(publicName({ name: "", email: "x@y.z", username: "xy" })).toBe("@xy");
  });

  it("shows a name the listener actually chose", () => {
    expect(publicName({ name: "Minus", email: "m@example.com", username: "minus" })).toBe("Minus");
  });

  it("copes with a missing profile", () => {
    expect(publicName(null)).toBe("Someone");
  });

  it("is what convex/social.ts uses for every name it hands out", () => {
    const src = readFileSync("convex/social.ts", "utf8");
    expect(src).toMatch(/const displayName = \(p: Doc<"profiles"> \| null\) => publicName\(p\);/);
    // no other path reads a profile's raw name into a response
    expect(src.match(/\bp\.name\b|profile\.name\b|owner\.name\b/g) ?? []).toEqual([]);
  });
});
