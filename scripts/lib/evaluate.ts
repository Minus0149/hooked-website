import { likeBias, trainFromHistory } from "../../src/data/predict";
import { soundScore, soundTaste } from "../../src/data/sound";
import type { SwipeAction, Track } from "../../src/types";

/**
 * Does the ranking beat a shuffle? The holdout test.
 *
 * Every listener's swipes are split in time: the first 80% train, the last
 * 20% are the exam. Each ranker scores the exam songs knowing only the
 * training swipes, and AUC asks how often a kept song (save or more-like-this)
 * outscored a dropped one (skip or never). 0.5 is a coin flip — exactly what a
 * shuffle scores — and 1.0 is perfect. Anything that doesn't clear 0.5 on real
 * swipes is decoration, whatever its idea.
 *
 * Uses the real client modules, so what's measured is what ships.
 */

export interface Swipe {
  userId: string;
  trackId: string;
  action: SwipeAction;
  /** ordering only; file order when the source has no clock */
  t: number;
}

export interface RankerResult {
  name: string;
  /** mean AUC across listeners who had an exam with both outcomes */
  auc: number;
  users: number;
}

export interface EvalReport {
  rankers: RankerResult[];
  users: number;
  examSwipes: number;
  trainShare: number;
}

const kept = (a: SwipeAction) => a === "save" || a === "more";

/** Mann–Whitney AUC: the chance a random positive outscores a random negative. */
export function auc(scores: number[], labels: (0 | 1)[]): number | null {
  const pos: number[] = [];
  const neg: number[] = [];
  scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** A deterministic stand-in for Math.random, so a shuffle scores the same every run. */
function hashScore(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export function evaluate(
  swipes: Swipe[],
  catalog: Track[],
  { trainShare = 0.8, minTrain = 10, minExam = 4 } = {},
): EvalReport {
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const byUser = new Map<string, Swipe[]>();
  for (const s of swipes) {
    if (!byId.has(s.trackId)) continue;
    byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  }

  const names = ["shuffle", "label model", "sound taste", "label model + sound"];
  const sums = new Map(names.map((n) => [n, { total: 0, users: 0 }]));
  let users = 0;
  let examSwipes = 0;

  for (const [userId, list] of byUser) {
    list.sort((a, b) => a.t - b.t);
    const cut = Math.floor(list.length * trainShare);
    const train = list.slice(0, cut);
    const exam = list.slice(cut);
    if (train.length < minTrain || exam.length < minExam) continue;
    const labels = exam.map((s) => (kept(s.action) ? 1 : 0) as 0 | 1);
    if (!labels.includes(1) || !labels.includes(0)) continue;

    const history = {
      saved: train.filter((s) => kept(s.action)).map((s) => byId.get(s.trackId)!),
      buried: train.filter((s) => s.action === "never").map((s) => s.trackId),
      skipped: train.filter((s) => s.action === "skip").map((s) => s.trackId),
      catalog,
    };
    const model = trainFromHistory(history);
    const taste = soundTaste(history);
    const examTracks = exam.map((s) => byId.get(s.trackId)!);

    const scores: Record<string, number[]> = {
      shuffle: exam.map((s) => hashScore(userId + s.trackId)),
      "label model": examTracks.map((t) => likeBias(model, t)),
      "sound taste": examTracks.map((t) => soundScore(taste, t) * (taste?.confidence ?? 0)),
      "label model + sound": examTracks.map(
        (t) => likeBias(model, t) + soundScore(taste, t) * (taste?.confidence ?? 0),
      ),
    };
    users++;
    examSwipes += exam.length;
    for (const n of names) {
      const a = auc(scores[n], labels);
      if (a === null) continue;
      const acc = sums.get(n)!;
      acc.total += a;
      acc.users++;
    }
  }

  return {
    rankers: names.map((name) => {
      const { total, users: u } = sums.get(name)!;
      return { name, auc: u > 0 ? Math.round((total / u) * 1000) / 1000 : 0.5, users: u };
    }),
    users,
    examSwipes,
    trainShare,
  };
}
