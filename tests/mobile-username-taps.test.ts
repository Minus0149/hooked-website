import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Seen on the emulator 2026-10-20: the profile's username Save needed two taps,
 * because a ScrollView spends the first tap closing the keyboard. Every
 * scrolling screen with a text field and a button must let the tap through.
 */
describe("the phone's text fields", () => {
  for (const file of ["ProfileScreen.tsx", "SearchScreen.tsx"]) {
    it(`${file} lets a tap through while the keyboard is open`, () => {
      const src = readFileSync(`../mobile/src/components/${file}`, "utf8");
      expect(src).toMatch(/keyboardShouldPersistTaps="handled"/);
    });
  }
});
