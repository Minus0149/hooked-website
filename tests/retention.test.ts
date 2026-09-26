import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, retentionCutoff, songReportExpired } from "../convex/retention";

/**
 * The privacy policy says crash reports are deleted within 90 days and song
 * reports 90 days after they were acted on. These are the lines the daily
 * sweep draws.
 */
const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 8, 26);

describe("report retention", () => {
  it("draws the line 90 days back", () => {
    expect(RETENTION_DAYS).toBe(90);
    expect(retentionCutoff(NOW)).toBe(NOW - 90 * DAY);
    // a crash report from 91 days ago is past it, one from 89 days ago isn't
    expect(NOW - 91 * DAY < retentionCutoff(NOW)).toBe(true);
    expect(NOW - 89 * DAY < retentionCutoff(NOW)).toBe(false);
  });

  it("keeps open song reports however old they are", () => {
    expect(songReportExpired({ status: "open" }, NOW)).toBe(false);
    expect(songReportExpired({ status: "open", resolvedAt: NOW - 400 * DAY }, NOW)).toBe(false);
  });

  it("deletes resolved song reports 90 days after they were resolved", () => {
    for (const status of ["dismissed", "actioned"]) {
      expect(songReportExpired({ status, resolvedAt: NOW - 91 * DAY }, NOW)).toBe(true);
      expect(songReportExpired({ status, resolvedAt: NOW - 89 * DAY }, NOW)).toBe(false);
    }
  });

  it("never deletes a resolved report with no resolution time", () => {
    expect(songReportExpired({ status: "dismissed" }, NOW)).toBe(false);
  });
});
