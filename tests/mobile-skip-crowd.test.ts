import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HAS_MOBILE } from "./mobile-sibling";

/**
 * "Not feeling these?" (8e50157) and the crowd reveal (6193579) on the phone,
 * ported for v8. The rules are the same files on both clients; the phone's
 * screens wire them the way web/src/App.tsx does.
 */
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/^﻿/, "");
const mobile = (p: string) => (HAS_MOBILE ? read(`../mobile/${p}`) : "");

describe.skipIf(!HAS_MOBILE)("the phone's skip-streak and crowd-reveal rules", () => {
  for (const lib of ["skipStreak.ts", "crowdReveal.ts"]) {
    it(`lib/${lib} is the web's file, byte for byte`, () => {
      expect(mobile(`src/lib/${lib}`)).toBe(read(`src/lib/${lib}`));
    });
    it(`lib/${lib} is guarded by the phone's mirror check`, () => {
      expect(mobile("scripts/check-mirrors.mjs")).toContain(`"lib/${lib}"`);
    });
  }

  it("answers the same as the web's copy", async () => {
    const url = new URL("../../mobile/src/lib/crowdReveal.ts", import.meta.url).href;
    const m = (await import(/* @vite-ignore */ url)) as typeof import("../src/lib/crowdReveal");
    expect(m.crowdReveal({ listeners: 10, saves: 7, skips: 3 }, "save")).toMatchObject({ kind: "crowd", savePct: 70, withCrowd: true });
    expect(m.crowdReveal({ listeners: 2, saves: 1, skips: 1 }, "skip").kind).toBe("first");
    const s = new URL("../../mobile/src/lib/skipStreak.ts", import.meta.url).href;
    const k = (await import(/* @vite-ignore */ s)) as typeof import("../src/lib/skipStreak");
    expect(k.offerReset(k.SKIP_STREAK, 0)).toBe(true);
    expect(k.trailingSkips([{ action: "save" }, { action: "skip" }])).toBe(1);
  });
});

describe.skipIf(!HAS_MOBILE)("the phone's App wires them like the web", () => {
  const app = mobile("App.tsx");

  it("offers the prompt only outside a playing session, quiet until the next full run", () => {
    expect(app).toMatch(/const skipRun = trailingSkips\(state\.history\);/);
    expect(app).toMatch(/const showSkipPrompt = !state\.session && offerReset\(skipRun, skipQuietAt\);/);
    expect(app).toMatch(/if \(skipRun < skipQuietAt\) setSkipQuietAt\(0\);/);
    expect(app).toMatch(/showSkipPrompt && !activeAd && \(\s*<SkipStreakPrompt/);
    expect(app).toMatch(/freshSuggestions\(\);/);
  });

  it("prefetches the crowd for the card on screen and reveals it on up/down only, never in a session", () => {
    expect(app).toMatch(/useQuery\(anyApi\.verdicts\.forTrack, onDeck \? \{ trackId: onDeck\.id \} : "skip"\)/);
    expect(app).toMatch(/dir === "up" \|\| dir === "down" \? verdictOf\(action\) : null/);
    expect(app).toMatch(/if \(track && verdict && !state\.session\)/);
    expect(app).toMatch(/setTimeout\(\(\) => setCrowd\(null\), 2600\)/);
  });

  for (const c of ["SkipStreakPrompt.tsx", "CrowdReveal.tsx"]) {
    it(`${c} follows the in-app motion setting, not the OS flag`, () => {
      const src = mobile(`src/components/${c}`);
      expect(src).toMatch(/motion: MotionLevel/);
      expect(src).toMatch(/ReduceMotion\.Never/);
      expect(src).not.toMatch(/ReduceMotion\.System|isReduceMotionEnabled|useReducedMotion/);
    });
  }

  it("the prompt offers every mood, fresh suggestions and keep going", () => {
    const src = mobile("src/components/SkipStreakPrompt.tsx");
    expect(src).toMatch(/MOODS\.map/);
    expect(src).toContain("Fresh suggestions");
    expect(src).toContain("Keep going");
    expect(src).toContain("Not feeling these?");
  });

  it("the reveal says who agreed, the streak from two, and 'one of the first' below the crowd floor", () => {
    const src = mobile("src/components/CrowdReveal.tsx");
    expect(src).toContain("— with the crowd");
    expect(src).toContain("— against the crowd");
    expect(src).toMatch(/streak >= 2/);
    expect(src).toContain("You're one of the first to judge this one.");
  });
});
