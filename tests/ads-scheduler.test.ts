import { describe, expect, it } from "vitest";
import { shouldAskForAd } from "../src/lib/ads-scheduler";

const cfg = { enabled: true, everyNSwipes: 12, cooldownMinutes: 10 };
const NOW = 1_000_000_000;

describe("shouldAskForAd", () => {
  it("stays quiet when the listener opted out", () => {
    expect(
      shouldAskForAd({ swipesSinceAd: 50, now: NOW, lastAdAt: 0, optedOut: true, config: cfg }),
    ).toBe(false);
  });

  it("does nothing while ads are disabled globally", () => {
    expect(
      shouldAskForAd({
        swipesSinceAd: 99,
        now: NOW,
        lastAdAt: 0,
        optedOut: false,
        config: { ...cfg, enabled: false },
      }),
    ).toBe(false);
  });

  it("waits for the swipe gap", () => {
    expect(
      shouldAskForAd({ swipesSinceAd: 11, now: NOW, lastAdAt: 0, optedOut: false, config: cfg }),
    ).toBe(false);
    expect(
      shouldAskForAd({ swipesSinceAd: 12, now: NOW, lastAdAt: 0, optedOut: false, config: cfg }),
    ).toBe(true);
  });

  it("respects the cooldown even past the swipe gap", () => {
    const nineMinAgo = NOW - 9 * 60_000;
    expect(
      shouldAskForAd({ swipesSinceAd: 20, now: NOW, lastAdAt: nineMinAgo, optedOut: false, config: cfg }),
    ).toBe(false);
    const tenMinAgo = NOW - 10 * 60_000;
    expect(
      shouldAskForAd({ swipesSinceAd: 12, now: NOW, lastAdAt: tenMinAgo, optedOut: false, config: cfg }),
    ).toBe(true);
  });

  it("never gets denser than one card per three swipes in swipe mode", () => {
    const tight = { enabled: true, everyNSwipes: 1, cooldownMinutes: 0 };
    // everyNSwipes 1 means TIME mode — for swipe pacing use >= 3
    expect(
      shouldAskForAd({ swipesSinceAd: 2, now: NOW, lastAdAt: 0, optedOut: false, config: { ...tight, everyNSwipes: 3 } }),
    ).toBe(false);
    expect(
      shouldAskForAd({ swipesSinceAd: 3, now: NOW, lastAdAt: 0, optedOut: false, config: { ...tight, everyNSwipes: 3 } }),
    ).toBe(true);
  });

  it("time mode: the cooldown is the whole cadence — no swipe count needed", () => {
    const every30min = { enabled: true, everyNSwipes: 1, cooldownMinutes: 30 };
    // only two swipes, but 31 minutes have passed → due
    expect(
      shouldAskForAd({
        swipesSinceAd: 2,
        now: NOW,
        lastAdAt: NOW - 31 * 60_000,
        optedOut: false,
        config: every30min,
      }),
    ).toBe(true);
    // twenty swipes, but only 10 minutes → not due
    expect(
      shouldAskForAd({
        swipesSinceAd: 20,
        now: NOW,
        lastAdAt: NOW - 10 * 60_000,
        optedOut: false,
        config: every30min,
      }),
    ).toBe(false);
  });
});
