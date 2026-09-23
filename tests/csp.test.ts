import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - plain ESM shared with vite.config.ts
import { connectSources, CONNECT_PLACEHOLDER } from "../scripts/lib/csp.mjs";

/**
 * A CSP that names the wrong backend doesn't fail loudly: the page renders and
 * the sign-in button spins forever. That happened once, when the backend moved.
 */
describe("the backend the page may connect to", () => {
  it("follows the Convex URLs the client is built with, sockets included", () => {
    const src = connectSources({
      VITE_CONVEX_URL: "https://happy-otter-123.convex.cloud",
      VITE_CONVEX_SITE_URL: "https://happy-otter-123.convex.site/",
    });
    expect(src.split(" ")).toEqual([
      "'self'",
      "https://happy-otter-123.convex.cloud",
      "wss://happy-otter-123.convex.cloud",
      "https://happy-otter-123.convex.site",
      "wss://happy-otter-123.convex.site",
      "https://audio-ssl.itunes.apple.com",
    ]);
  });

  it("works against a local backend too", () => {
    const src = connectSources({ VITE_CONVEX_URL: "http://127.0.0.1:3210" });
    expect(src).toContain("ws://127.0.0.1:3210");
  });

  it("allows only itself and the preview CDN when no backend is configured", () => {
    expect(connectSources({})).toBe("'self' https://audio-ssl.itunes.apple.com");
  });

  it("lets the hook editor fetch a preview to draw its waveform", () => {
    expect(connectSources({})).toContain("https://audio-ssl.itunes.apple.com");
  });

  it("refuses a URL it can't make sense of rather than widening the policy", () => {
    expect(() => connectSources({ VITE_CONVEX_URL: "convex.cloud" })).toThrow();
    expect(() => connectSources({ VITE_CONVEX_URL: "javascript:alert(1)" })).toThrow();
  });

  it("is actually wired into both copies of the policy", () => {
    for (const file of ["index.html", "public/_headers"]) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(text).toContain(`connect-src ${CONNECT_PLACEHOLDER};`);
      expect(text).not.toContain("hookedcue.com wss://");
    }
  });
});
