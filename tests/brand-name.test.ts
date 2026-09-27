import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The product is written "HookedCue" wherever a person reads it (Minus,
 * 2026-09-27). Domains, mail addresses, the package id, storage keys and file
 * names stay lowercase — this only catches the name used as a word.
 */
const AS_A_WORD = /(?<![A-Za-z0-9_@./:\-])hookedcue(?![A-Za-z0-9_@\-])(?!\.[A-Za-z])(?!:[A-Za-z])/;

describe("the product name", () => {
  it("is HookedCue wherever it is read as a word", () => {
    const files = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(tsx?|html|json|md|txt)$/.test(f) && !/(^|\/)package(-lock)?\.json$/.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (AS_A_WORD.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("is the name under the phone's launcher icon, with the store id unchanged", () => {
    const app = JSON.parse(readFileSync("../mobile/app.json", "utf8")).expo;
    expect(app.name).toBe("HookedCue");
    expect(app.android.package).toBe("com.minus.hookedcue");
    expect(app.slug).toBe("hooked-music");
  });

  it("opens on the hook mark, not Expo's template splash (the grid and circles)", async () => {
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(readFileSync("../mobile/assets/splash-icon.png")).digest("hex");
    const template = "5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8";
    expect(sha).not.toBe(template);
  });

  it("leaves the addresses alone", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("HookedCue");
    expect(html).not.toMatch(/HookedCue\.com/);
  });
});
