import { describe, expect, it } from "vitest";
import { applyOriginAllowed } from "../convex/applyOrigin";

/**
 * The phone app applies for access through the same route as the web app, and
 * a native request carries no Origin — refusing that locked Android testers out
 * of the only form that lets them in.
 */
describe("applyOriginAllowed", () => {
  const app = "https://app.hookedcue.com";
  it("accepts the web app's own origin", () => {
    expect(applyOriginAllowed(app, app)).toBe(true);
  });
  it("accepts the phone app, which sends no Origin", () => {
    expect(applyOriginAllowed(null, app)).toBe(true);
  });
  it("refuses a page on any other site", () => {
    expect(applyOriginAllowed("https://evil.example", app)).toBe(false);
    expect(applyOriginAllowed("http://app.hookedcue.com", app)).toBe(false);
  });
});
