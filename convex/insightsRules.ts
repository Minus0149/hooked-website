/**
 * Free hook insights for artists — the arithmetic and the privacy floor, kept
 * free of Convex so both can be tested. convex/insights.ts does the storage.
 *
 * Privacy: an artist sees counts, never listeners. Nothing is shown for a song
 * fewer than PRIVACY_FLOOR people have heard, and a mood or genre with fewer
 * than PRIVACY_FLOOR listeners is folded into "other" — on a small song a
 * count of one or two is a person, not an audience.
 */

export const PRIVACY_FLOOR = 5;

/** Seconds into the hook we track skips for; later skips land in the last bucket. */
export const SKIP_SECONDS = 30;

export function emptySkipAt(): number[] {
  return Array.from({ length: SKIP_SECONDS }, () => 0);
}

/** Which one-second bucket a skip at `atMs` into the hook belongs to. */
export function skipBucket(atMs: number): number {
  if (!Number.isFinite(atMs) || atMs < 0) return 0;
  return Math.min(SKIP_SECONDS - 1, Math.floor(atMs / 1000));
}

export type InsightRow = {
  listeners: number;
  plays: number;
  saves: number;
  skips: number;
  more: number;
  never: number;
  skipAt: number[];
  moods: Record<string, number>;
  genres: Record<string, number>;
};

export type PublicInsights =
  | { enough: false; floor: number }
  | {
      enough: true;
      listeners: number;
      plays: number;
      saves: number;
      skips: number;
      more: number;
      never: number;
      /** % of plays that ended in a save or "more like this" */
      saveRate: number;
      /** % of plays still listening at each second into the hook */
      stillListening: number[];
      /** the second where the most listeners leave, or null if too few skips */
      steepestDrop: number | null;
      moods: { name: string; share: number }[];
      genres: { name: string; share: number }[];
    };

/** Top entries by count, anything under the floor folded into "other", as % shares. */
export function shares(counts: Record<string, number>, floor = PRIVACY_FLOOR, top = 6): { name: string; share: number }[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total < floor) return [];
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const shown = sorted.filter(([, n]) => n >= floor).slice(0, top);
  const other = total - shown.reduce((a, [, n]) => a + n, 0);
  const out = shown.map(([name, n]) => ({ name, share: Math.round((n / total) * 100) }));
  if (other > 0) out.push({ name: "other", share: Math.round((other / total) * 100) });
  return out;
}

/**
 * The drop-off curve: of every play, the share still listening at the start
 * of each second. Skips without a time (old app builds) count as leaving at
 * the end, so they lower the curve only where they are known to have left.
 */
export function stillListening(plays: number, skipAt: number[]): number[] {
  if (plays <= 0) return [];
  let gone = 0;
  return skipAt.map((n) => {
    const here = Math.round(((plays - gone) / plays) * 100);
    gone += n;
    return here;
  });
}

export function publicInsights(row: InsightRow | null, floor = PRIVACY_FLOOR): PublicInsights {
  if (!row || row.listeners < floor) return { enough: false, floor };
  const timed = row.skipAt.reduce((a, b) => a + b, 0);
  let steepest: number | null = null;
  if (timed >= floor) {
    let best = -1;
    row.skipAt.forEach((n, i) => {
      if (n > best) {
        best = n;
        steepest = i;
      }
    });
  }
  return {
    enough: true,
    listeners: row.listeners,
    plays: row.plays,
    saves: row.saves,
    skips: row.skips,
    more: row.more,
    never: row.never,
    saveRate: row.plays > 0 ? Math.round(((row.saves + row.more) / row.plays) * 1000) / 10 : 0,
    stillListening: stillListening(row.plays, row.skipAt),
    steepestDrop: steepest,
    moods: shares(row.moods, floor),
    genres: shares(row.genres, floor),
  };
}
