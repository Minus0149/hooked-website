import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - plain ESM shared with vite.config.ts
import { parseEnvFile, pinnedBackend } from "../scripts/lib/backend-env.mjs";

/**
 * The live app once kept building against a backend that was down, because
 * the URL lived only in the host's settings. A production build now takes the
 * backend from the committed file.
 */
describe("which backend a build talks to", () => {
  const committed = parseEnvFile(readFileSync(new URL("../.env.production", import.meta.url), "utf8"));

  it("names Convex Cloud for production, client and auth together", () => {
    expect(committed.VITE_CONVEX_URL).toMatch(/^https:\/\/[a-z0-9-]+\.convex\.cloud$/);
    expect(committed.VITE_CONVEX_SITE_URL).toBe(
      committed.VITE_CONVEX_URL.replace(".convex.cloud", ".convex.site"),
    );
  });

  it("pins only the backend keys, and only for production builds", () => {
    const file = { ...committed, VITE_BETA_URL: "https://example.com" };
    expect(Object.keys(pinnedBackend("production", file)).sort()).toEqual([
      "VITE_CONVEX_SITE_URL",
      "VITE_CONVEX_URL",
    ]);
    expect(pinnedBackend("development", file)).toEqual({});
  });

  it("reads env files the way people write them", () => {
    expect(parseEnvFile('# note\n\nA=1\nB="two"\n  C = three \nnot a line\n')).toEqual({
      A: "1",
      B: "two",
      C: "three",
    });
  });
});
