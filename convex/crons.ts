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

export default crons;
