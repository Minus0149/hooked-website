import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 3 Nov 2026, on 320x568 / 360x640 / 375x667: the tour's step was centred
 * between the logo and the buttons and spilled out both ways (headline over
 * the logo, copy under the dots, genre chips under the button), and the home
 * screen kept drawing its blurred glow under the opaque tour. Pin the fixes.
 */
const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
const tour = readFileSync(new URL("../src/components/Onboarding.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

describe("first-run tour on short phones", () => {
  it("keeps the step's top in view and sizes the demo card from the screen height", () => {
    expect(css).toMatch(/\.ob-step-wrap \{ justify-content: safe center; \}/);
    expect(css).toMatch(/\.ob-demo \{ width: min\(240px, 60vw, calc\(40svh \* 0\.75\)\); \}/);
    expect(css).toMatch(/@media \(max-height: 720px\)/);
    expect(css).toMatch(/@media \(max-height: 600px\)/);
  });

  it("lets the three taste questions scroll, never the gesture steps (a dragged card would clip)", () => {
    expect(tour.match(/className="ob-step-wrap ob-scroll"/g)?.length).toBe(3);
    expect(css).toMatch(/\.ob-scroll \{\s*overflow-y: auto;/);
  });

  it("moves the up/down hint arrows inside the card on short screens", () => {
    expect(tour).toMatch(/data-dir=\{gs\.dir\}/);
    expect(css).toMatch(/\.ob-arrow\[data-dir="up"\] \{ top: 8px !important; \}/);
  });

  it("hides what the tour covers instead of compositing it", () => {
    expect(app).toMatch(/data-touring=\{!onboarded \|\| undefined\}/);
    expect(css).toMatch(/\.phone\[data-touring\] \.screen > :not\(\.onboarding\):not\(\.toast\) \{ visibility: hidden; \}/);
  });

  it("no full-screen blur filters left on the glow layers or the swipe stamps", () => {
    expect(css).not.toMatch(/filter: blur\(40px\)/);
    expect(css).not.toMatch(/filter: blur\(50px\)/);
    expect(css).not.toMatch(/animation: drift 14s/);
    const stamp = css.slice(css.indexOf(".stamp {"), css.indexOf(".stamp-up"));
    expect(stamp).not.toMatch(/backdrop-filter:/);
  });
});
