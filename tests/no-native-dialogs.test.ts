import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The app once had eighteen window.alert / window.confirm calls and two native
 * <select>s: grey browser boxes with the site address in the title, blocking
 * the tab. ui/Dialogs.tsx replaced them; this keeps them from coming back.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

describe("the app uses its own UI, never the browser's", () => {
  const root = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const files = sources(root);
  for (const file of files) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    it(`${file.slice(root.length + 1)}: no alert/confirm/prompt, no native <select>`, () => {
      expect(code).not.toMatch(/\bwindow\.(alert|confirm|prompt)\s*\(/);
      expect(code).not.toMatch(/(^|[^.\w])(alert|prompt)\s*\(/);
      expect(code).not.toMatch(/<select\b/);
    });
  }
});
