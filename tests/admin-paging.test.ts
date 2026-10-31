import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReportGroup } from "../convex/contentReports";
import { mergeReportGroups } from "../src/lib/reportGroups";

/**
 * The admin's access queue returned every request ever made in one query (and
 * re-sent all of it on every signup); the open song reports stopped at the
 * newest 500. Both are paged on the server now, with "load more" in the UI.
 */
const read = (...p: string[]) => readFileSync(resolve(__dirname, "..", ...p), "utf8");
const fnBody = (file: string, name: string) => {
  const s = read("convex", file);
  const start = s.indexOf(`export const ${name} = `);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = s.indexOf("\nexport ", start + 1);
  return s.slice(start, next < 0 ? undefined : next);
};

const g = (trackId: string, over: Partial<ReportGroup> = {}): ReportGroup => ({
  trackId,
  title: trackId,
  artist: "a",
  artwork: null,
  hidden: false,
  count: 1,
  reasons: { spam: 1 },
  notes: [],
  lastAt: 1,
  ...over,
});

describe("report pages join into one row per track", () => {
  it("adds counts and reasons, keeps three notes and the latest time", () => {
    const merged = mergeReportGroups([
      g("t1", { count: 2, reasons: { copyright: 2 }, notes: ["a", "b"], lastAt: 50 }),
      g("t2", { count: 1, lastAt: 40 }),
      g("t1", { count: 3, reasons: { copyright: 1, spam: 2 }, notes: ["c", "d"], lastAt: 10, artwork: "x" }),
    ]);
    expect(merged.map((m) => m.trackId)).toEqual(["t1", "t2"]);
    expect(merged[0]).toMatchObject({ count: 5, reasons: { copyright: 3, spam: 2 }, notes: ["a", "b", "c"], lastAt: 50, artwork: "x" });
  });

  it("most reported first, then the newest", () => {
    const merged = mergeReportGroups([g("old", { lastAt: 1 }), g("new", { lastAt: 9 }), g("many", { count: 4 })]);
    expect(merged.map((m) => m.trackId)).toEqual(["many", "new", "old"]);
  });

  it("doesn't change the pages it was given", () => {
    const first = g("t1", { reasons: { spam: 1 } });
    mergeReportGroups([first, g("t1")]);
    expect(first.count).toBe(1);
    expect(first.reasons.spam).toBe(1);
  });
});

describe("both admin lists are paged on the server", () => {
  it("access.list paginates, by status when filtered, capped at 100 a page", () => {
    const list = fnBody("access.ts", "list");
    expect(list).toMatch(/paginationOpts: paginationOptsValidator/);
    expect(list).toMatch(/withIndex\("by_status", \(q\) => q\.eq\("status", status\)\)\.order\("desc"\)\.paginate\(opts\)/);
    expect(list).toMatch(/Math\.min\(Math\.max\(1, paginationOpts\.numItems\), 100\)/);
    expect(list).not.toMatch(/\.collect\(\)/);
    expect(list).toMatch(/requirePermission\(ctx, "users\.view"\)/);
  });

  it("access.counts reads index ranges up to a cap, never the whole table", () => {
    const counts = fnBody("access.ts", "counts");
    expect(counts).not.toMatch(/\.collect\(\)/);
    expect(counts.match(/\.take\(COUNT_CAP\)/g)?.length).toBe(2);
    expect(counts).toMatch(/requirePermission\(ctx, "users\.view"\)/);
  });

  it("contentReports.listOpen paginates the open reports", () => {
    const list = fnBody("contentReports.ts", "listOpen");
    expect(list).toMatch(/args: \{ paginationOpts: paginationOptsValidator \}/);
    expect(list).toMatch(/\.paginate\(opts\)/);
    expect(list).not.toMatch(/\.take\(500\)/);
    expect(list).toMatch(/requirePermission\(ctx, "catalog\.curate"\)/);
  });

  it("the dashboard pages both, with load more", () => {
    const requests = read("src", "components", "admin", "Requests.tsx");
    expect(requests).toMatch(/usePaginatedQuery\(\s*api\.access\.list/);
    expect(requests).toMatch(/paged\.loadMore\(PAGE\)/);
    const dash = read("src", "components", "AdminDashboard.tsx");
    expect(dash).toMatch(/useQuery\(api\.access\.counts/);
    expect(dash).toMatch(/usePaginatedQuery\(api\.contentReports\.listOpen/);
    expect(dash).toMatch(/mergeReportGroups\(reportPages\.results\)/);
    expect(read("src", "components", "admin", "SongReports.tsx")).toMatch(/onLoadMore && \(/);
  });
});
