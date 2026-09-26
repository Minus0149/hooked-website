import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * What the privacy policy promises (hookedcue.com/privacy): crash reports are
 * deleted within 90 days; song reports are kept until someone has acted on
 * them, then deleted within 90 days of that. Open song reports never expire —
 * they are waiting on a person, not on a clock.
 */
export const RETENTION_DAYS = 90;
/** rows deleted per table per run; a full batch schedules the next run */
export const SWEEP_BATCH = 500;

const DAY = 24 * 60 * 60_000;

/** anything stamped before this is past retention */
export function retentionCutoff(now: number, days = RETENTION_DAYS): number {
  return now - days * DAY;
}

/** a song report may go once it was resolved, and resolved long enough ago */
export function songReportExpired(
  report: { status: string; resolvedAt?: number },
  now: number,
): boolean {
  if (report.status === "open" || report.resolvedAt === undefined) return false;
  return report.resolvedAt < retentionCutoff(now);
}

export const sweepReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = retentionCutoff(now);
    const crashes = await ctx.db
      .query("errorReports")
      .withIndex("by_at", (q) => q.lt("at", cutoff))
      .take(SWEEP_BATCH);
    for (const row of crashes) await ctx.db.delete(row._id);

    let songs = 0;
    for (const status of ["dismissed", "actioned"] as const) {
      const rows = await ctx.db
        .query("contentReports")
        .withIndex("by_status_resolved", (q) => q.eq("status", status).lt("resolvedAt", cutoff))
        .take(SWEEP_BATCH);
      for (const row of rows) {
        // the index range also admits a missing resolvedAt; never guess those away
        if (!songReportExpired(row, now)) continue;
        await ctx.db.delete(row._id);
        songs++;
      }
      if (rows.length === SWEEP_BATCH) songs = SWEEP_BATCH; // more left: go again
    }
    if (crashes.length === SWEEP_BATCH || songs === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(60_000, internal.retention.sweepReports, {});
    }
    return { crashes: crashes.length, songs };
  },
});
