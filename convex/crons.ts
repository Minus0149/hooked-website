import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Hook ranking is the one place a swipe's effect reaches the catalogue, and it
 * is batched here on purpose. Doing it inline would rewrite rows that every
 * client's catalogue query depends on, thousands of times an hour.
 *
 * Hourly is fast enough: a hook needs 20 plays before it is allowed to move at
 * all, so nothing is waiting on a shorter interval.
 */
const crons = cronJobs();

crons.hourly(
  "rank hooks by save rate",
  { minuteUTC: 7 },
  internal.hooks.rerank,
);

crons.hourly(
  "compute catalogue heat for the adventure answer",
  { minuteUTC: 11 },
  internal.hooks.computeHeat,
);

/**
 * Import runs live in a browser tab; if that tab dies mid-match the run row
 * sits in status:"matching" forever, holding its token. Sweep them so the
 * dashboard shows an honest failure instead of an eternal spinner.
 */
crons.interval(
  "sweep stale import runs",
  { minutes: 10 },
  internal.imports.sweepStale,
);

/**
 * Fold recent activity into statsDaily so the admin ticker stays reactive
 * WITHOUT scanning history. Cheap by construction: each run only touches rows
 * newer than the previous run's watermark.
 */
crons.interval(
  "rollup daily counters",
  { minutes: 10 },
  internal.admin.rollupStats,
);

// The analytics snapshot is the expensive report (it reads history once) —
// computed offline, read instantly. Nightly keeps it fresh enough; admins can
// also recompute on demand from the dashboard.
crons.daily(
  "recompute analytics snapshot",
  { hourUTC: 3, minuteUTC: 17 },
  internal.admin.computeSnapshot,
  {},
);

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

/**
 * Rebuild "people who reacted to this reacted to that" from the swipe log.
 *
 * Six-hourly rather than hourly: unlike hook ranking, one more listener's
 * afternoon barely moves a cosine, and the run reads history rather than a
 * counters table. Offset from the others so the heavy jobs never share a
 * minute.
 */
crons.interval(
  "rebuild the recommendation model",
  { hours: 6 },
  internal.recommend.rebuild,
);

/**
 * Keep the catalogue current.
 *
 * Nightly and deliberately partial: each run takes the next handful of Apple's
 * hundred chart feeds, so a full sweep takes about ten days and no single run
 * can be the one that fails. Anything new arrives with provisional hooks until
 * scripts/analyze-hooks.mjs measures its audio.
 */
crons.daily(
  "pull new songs from the charts",
  { hourUTC: 5, minuteUTC: 23 },
  internal.charts.refresh,
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

export default crons;
