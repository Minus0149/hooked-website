import { describe, expect, it } from "vitest";
import {
  cleanReportNote,
  isReportReason,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
} from "../src/lib/contentReport";
import { COPYRIGHT_INBOX, REPORT_REASON_IDS, reportLimit, reporterKey } from "../convex/contentReports";

/**
 * "Report this song" (Google Play's UGC policy). The form and the server must
 * agree on the reasons, anyone — guests too — must be held to a limit, and the
 * free-text note is cleaned before it's stored or emailed.
 */
describe("report this song", () => {
  it("offers exactly the reasons the server accepts", () => {
    expect(REPORT_REASONS.map((r) => r.id)).toEqual([...REPORT_REASON_IDS]);
    expect(isReportReason("copyright")).toBe(true);
    expect(isReportReason("because")).toBe(false);
  });

  it("holds guests and accounts to a limit, and refuses anyone it can't identify", () => {
    expect(reporterKey("k17abc", null)).toBe("user:k17abc");
    expect(reporterKey(null, "anon-9x2lq0ab1f")).toBe("anon:anon-9x2lq0ab1f");
    expect(reporterKey(null, "")).toBeNull();
    expect(reporterKey(null, "<script>")).toBeNull();
    expect(reportLimit("user:k17abc")).toBeGreaterThan(reportLimit("anon:anon-9x2lq0ab1f"));
  });

  it("cleans and caps the note", () => {
    expect(cleanReportNote("  this is   my\nsong  ")).toBe("this is my song");
    expect(cleanReportNote("x".repeat(500))).toHaveLength(REPORT_NOTE_MAX);
    expect(cleanReportNote(undefined)).toBe("");
  });

  it("sends copyright reports to the copyright inbox the legal pages name", () => {
    expect(COPYRIGHT_INBOX).toBe("copyright@hookedcue.com");
  });
});
