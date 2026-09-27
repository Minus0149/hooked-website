import { describe, expect, it } from "vitest";
import { REBUILD_DELAY_MS, rebuildDelayMs } from "../convex/catalog";

/**
 * Rebuilding the catalogue 20 s after every write cost 3.17 GB of file writes
 * in a few days on the free plan (2026-09-27): each build re-reads every track
 * and every open app downloads the new file. Background changes now wait for
 * the cadence; only urgent ones (an admin hide) go straight away.
 */
describe("rebuildDelayMs", () => {
  const H = 3_600_000;
  it("waits for the cadence after a recent build", () => {
    expect(rebuildDelayMs({ now: 10 * H, builtAt: 9 * H, minIntervalMs: 12 * H })).toBe(11 * H);
  });
  it("never goes below the short delay, even when overdue", () => {
    expect(rebuildDelayMs({ now: 30 * H, builtAt: 1 * H, minIntervalMs: 12 * H })).toBe(REBUILD_DELAY_MS);
  });
  it("builds an urgent change straight away", () => {
    expect(rebuildDelayMs({ now: 10 * H, builtAt: 9.9 * H, minIntervalMs: 12 * H, urgent: true })).toBe(REBUILD_DELAY_MS);
  });
  it("treats a never-built catalogue as overdue", () => {
    expect(rebuildDelayMs({ now: 5 * H, minIntervalMs: 12 * H })).toBe(REBUILD_DELAY_MS);
  });
});
