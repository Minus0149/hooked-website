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

export default crons;
