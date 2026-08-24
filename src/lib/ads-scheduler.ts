/**
 * The client half of the house-ads contract.
 *
 * The server enforces the hard caps authoritatively (daily ceiling, cooldown —
 * see convex/ads.ts). This decides whether the deck should even ASK for a card
 * yet, based only on what the client knows: how many organic swipes have
 * happened since the last one and whether the configured gap has passed.
 *
 * Pure function so it can be unit-tested without React or Convex.
 */
export interface AdPacingInput {
  /** organic swipes since the last card */
  swipesSinceAd: number;
  now: number;
  lastAdAt: number;
  optedOut: boolean;
  config?: {
    enabled: boolean;
    everyNSwipes: number;
    cooldownMinutes: number;
  } | null;
}

export function shouldAskForAd({
  swipesSinceAd,
  now,
  lastAdAt,
  optedOut,
  config,
}: AdPacingInput): boolean {
  if (optedOut) return false;
  if (!config?.enabled) return false;
  const gap = Math.max(3, config.everyNSwipes); // never denser than 1-in-3
  if (swipesSinceAd < gap || swipesSinceAd === 0) return false;
  return now - lastAdAt >= config.cooldownMinutes * 60_000;
}
