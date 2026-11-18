import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Hook ranking is the one place a swipe's effect reaches the catalogue, and it
 * is batched here on purpose. Doing it inline would rewrite rows that every
 * client's catalogue query depends on, thousands of times an hour.
 *
 * Every 6 hours is fast enough: a hook needs 20 plays before it is allowed to
 * move at all, so nothing is waiting on a shorter interval.
 */
const crons = cronJobs();

/**
 * Set HOOKED_CRONS=off on a deployment to run none of these (the dev
 * deployment: its copy of every job read the same tables as prod and spent
 * the same free-plan database I/O for nothing).
 */
export function schedulesOn(env: Record<string, string | undefined>): boolean {
  return env.HOOKED_CRONS?.trim().toLowerCase() !== "off";
}

// Every 6 hours, not hourly: both ranking jobs read every hookStats row and
// the hot tracks (sound profiles and all), 24 times a day on a plan with
// ~33 MB of database I/O a day. A hook needs 20 plays before it moves anyway.
crons.interval(
  "rank hooks by save rate",
  { hours: 6 },
  internal.hooks.rerank,
);

crons.interval(
  "compute catalogue heat for the adventure answer",
  { hours: 6 },
  internal.hooks.computeHeat,
);

/**
 * Import runs live in a browser tab; if that tab dies mid-match the run row
 * sits in status:"matching" forever, holding its token. Sweep them so the
 * dashboard shows an honest failure instead of an eternal spinner.
 */
crons.interval(
  "sweep stale import runs",
  { minutes: 60 },
  internal.imports.sweepStale,
);

/**
 * Fold recent activity into statsDaily so the admin ticker stays reactive
 * WITHOUT scanning history. Cheap by construction: each run only touches rows
 * newer than the previous run's watermark.
 */
crons.interval(
  "rollup daily counters",
  { minutes: 60 },
  internal.admin.rollupStats,
);

// The analytics snapshot (admin.computeSnapshot) is NOT scheduled any more.
// It reads every swipe, track and hook in one go; past ~10k tracks it went
// over Convex's per-call read limit and failed every night, after reading
// ~16 MB on prod and again on dev. That waste helped use up the free plan's
// database I/O (Nov 2026, deployments switched off). Admins can still
// recompute it from the dashboard; bring the nightly run back once it reads
// in pages.

// Ad event log: caps only need ~45 days of memory. Older rows are dead weight.
crons.daily(
  "sweep old ad events",
  { hourUTC: 4, minuteUTC: 7 },
  internal.ads.sweepOldEvents,
);

// The privacy policy's promise: crash reports go after 90 days, song reports
// 90 days after someone acted on them (open ones wait for a person).
crons.daily(
  "delete reports past retention",
  { hourUTC: 4, minuteUTC: 37 },
  internal.retention.sweepReports,
);

// Rate-limit rows and guests' promoted-card views, which device keys (free to
// mint) used to grow without end (convex/retention.ts).
crons.daily(
  "sweep expired rate limits",
  { hourUTC: 4, minuteUTC: 52 },
  internal.retention.sweepRateLimits,
);
crons.daily(
  "sweep old guest promotion views",
  { hourUTC: 5, minuteUTC: 7 },
  internal.retention.sweepAnonPromotionViews,
  {},
);

/**
 * Rebuild "people who reacted to this reacted to that" from the swipe log.
 *
 * Six-hourly rather than hourly: unlike hook ranking, one more listener's
 * afternoon barely moves a cosine, and the run reads history rather than a
 * counters table. Offset from the others so the heavy jobs never share a
 * minute.
 */
// Daily (was 6-hourly, Nov 2026): each run reads up to 6k swipes and every
// trackNeighbors row, and a few testers' swipes barely move it in a day.
crons.interval(
  "rebuild the recommendation model",
  { hours: 24 },
  internal.recommend.rebuild,
);

/**
 * Keep the catalogue current.
 *
 * Nightly and deliberately partial: each run takes the next handful of
 * Apple's 32 chart feeds (convex/catalogRules.ts), so a full sweep takes a
 * couple of days and no single run can be the one that fails. Anything new
 * arrives with provisional hooks until its audio is analysed.
 */
crons.daily(
  "pull new songs from the charts",
  { hourUTC: 5, minuteUTC: 23 },
  internal.charts.refresh,
  {},
);

/**
 * Then decide what the deck may deal: hide filler, covers, one artist's
 * fourth song, and songs that left every chart (convex/curation.ts). Half an
 * hour after the pull so today's chart clock is already set.
 */
// Every 3 days, not daily: a pass reads every track (hidden ones too, since it
// may un-hide them) and cost ~19 MB a day on prod, Nov 2026. New chart songs
// wait up to 3 days to be judged, which nothing in the deck notices.
crons.interval(
  "curate the catalogue",
  { hours: 72 },
  internal.curation.run,
  {},
);

/**
 * Paid promotion: end campaigns whose delivery window is over and refund the
 * listeners they didn't reach, pro rata (convex/promotions.ts). Daily is
 * enough — the refund rule counts listeners, not hours.
 */
crons.daily(
  "end overdue promotions and refund the rest",
  { hourUTC: 6, minuteUTC: 41 },
  internal.promotions.expireDue,
  {},
);

/** One "your invite is still waiting" email to people approved 3+ days ago with no account (10:37 IST). */
crons.daily(
  "remind approved people who never joined",
  { hourUTC: 5, minuteUTC: 7 },
  internal.access.remindUnjoined,
);

export default schedulesOn(process.env) ? crons : cronJobs();
