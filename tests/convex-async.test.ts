import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * TypeScript accepts `{ ...promise }` without a word — it's a valid object
 * spread that copies nothing. The analytics snapshot was built that way for
 * its whole life: every stored snapshot held only a timestamp, and the panel
 * crashed the app the first time anyone opened it. There's no linter here, so
 * this is the guard: no async function in convex/ is ever spread un-awaited.
 */
const dir = new URL("../convex/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

describe("the backend never spreads a promise", () => {
  const asyncNames = new Set<string>();
  const sources = files.map((f) => [f, readFileSync(new URL(f, dir), "utf8")] as const);
  for (const [, src] of sources) {
    for (const m of src.matchAll(/async function\s+(\w+)/g)) asyncNames.add(m[1]);
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*async\b/g)) asyncNames.add(m[1]);
  }

  it("finds the async helpers it is meant to check", () => {
    expect(asyncNames.has("computeAnalyticsPayload")).toBe(true);
  });

  for (const [file, src] of sources) {
    it(`${file}: every spread async call is awaited`, () => {
      const bad: string[] = [];
      for (const m of src.matchAll(/\.\.\.\s*(\(?\s*)(await\s+)?(\w+)\s*\(/g)) {
        if (asyncNames.has(m[3]) && !m[2]) bad.push(m[0]);
      }
      expect(bad).toEqual([]);
    });
  }
});
