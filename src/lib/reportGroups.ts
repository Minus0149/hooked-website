import type { ReportGroup } from "../../convex/contentReports";

/**
 * The admin's song reports arrive a page at a time (contentReports.listOpen),
 * each page grouped by track. A track reported on two pages shows once: counts
 * and reasons add up, notes keep the first three, the latest time wins. Then
 * the most-reported first, as the single query used to sort them.
 */
export function mergeReportGroups(pages: readonly ReportGroup[]): ReportGroup[] {
  const out = new Map<string, ReportGroup>();
  for (const g of pages) {
    const have = out.get(g.trackId);
    if (!have) {
      out.set(g.trackId, { ...g, reasons: { ...g.reasons }, notes: g.notes.slice(0, 3) });
      continue;
    }
    have.count += g.count;
    for (const [reason, n] of Object.entries(g.reasons) as [keyof ReportGroup["reasons"], number][]) {
      have.reasons[reason] = (have.reasons[reason] ?? 0) + n;
    }
    for (const note of g.notes) if (have.notes.length < 3) have.notes.push(note);
    have.lastAt = Math.max(have.lastAt, g.lastAt);
    have.hidden = have.hidden || g.hidden;
    have.artwork = have.artwork ?? g.artwork;
  }
  return [...out.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
