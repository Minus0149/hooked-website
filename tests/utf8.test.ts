import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Dokploy builds with Nixpacks, which refuses the whole build when any text file
// isn't valid UTF-8. A Windows-1252 "é" and an em dash in two test files stopped
// every deploy from 27 Sep to 24 Oct 2026, so CI now catches it first.
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|toml|txt|yml|yaml|svg)$/i;

describe("every tracked text file", () => {
  it("is valid UTF-8", () => {
    const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter((f) => TEXT.test(f));
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const bad = files.filter((f) => {
      try {
        decoder.decode(readFileSync(f));
        return false;
      } catch {
        return true;
      }
    });
    expect(bad).toEqual([]);
  });
});
