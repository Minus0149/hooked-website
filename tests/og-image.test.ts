// The share image index.html declares must exist in public/ and match its declared 1200x630 size.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("og image", () => {
  it("every og/twitter image in index.html exists and is 1200x630", () => {
    const html = fs.readFileSync("index.html", "utf8");
    const refs = new Set([...html.matchAll(/https:\/\/app\.hookedcue\.com\/(og-[\w-]+\.png)/g)].map((m) => m[1]));
    expect(refs.size).toBeGreaterThan(0);
    for (const r of refs) {
      const f = path.join("public", r);
      expect(fs.existsSync(f), `${r} missing`).toBe(true);
      const b = fs.readFileSync(f);
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 630]);
    }
  });
});
