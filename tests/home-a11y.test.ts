import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Lighthouse, 28 Oct 2026: Home's section headings jumped from the h1 to h3,
// and the Hook of the day button's aria-label didn't contain its visible text
// (voice-control users say what they see).
describe("Home accessibility", () => {
  const home = readFileSync("src/components/HomeScreen.tsx", "utf8");
  it("section headings follow the h1 as h2", () => {
    expect(home).not.toMatch(/<h3 className="section-title">/);
    expect(home).toMatch(/<h2 className="section-title">/);
  });
  it("the Hook of the day button is named by its visible text", () => {
    const card = home.slice(home.indexOf("function HookOfDayCard"), home.indexOf("function TrackRow"));
    expect(card).not.toContain("aria-label=");
  });
});
