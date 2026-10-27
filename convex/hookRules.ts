/**
 * Hook recognition v3 — turning a track's structure analysis into the windows
 * the players play. Pure: no database, so it's tested directly and shared by
 * ingest (hookPlans.ts) and the policy switch.
 *
 * Why v3 exists: v2 cut every 30 s Apple preview into three ~10 s windows that
 * overlapped (76 % of tracks replayed the same seconds; 8–10 s each). A preview
 * is already Apple's chosen excerpt, so there is only ever ONE hook in it:
 *
 *   audio <= 35 s → exactly one window (previewWindow): it opens on the bar
 *                   just before the hook and closes at the end of the last
 *                   whole 2-bar line that fits in the clip, so it never stops
 *                   mid-line where Apple cut the preview. At least MIN_HOOK_MS;
 *                   a hook too late for that opens earlier. The players fade
 *                   the last 1.5 s (src/lib/hookPlayback.ts). Tested by ear on
 *                   20 Hindi/Punjabi songs on 27 Oct 2026: 17 good.
 *   longer audio  → a creator's full upload: up to three DISTINCT sections,
 *                   never overlapping, each at least MIN_HOOK_MS.
 *
 * Which start is used depends on the admin's policy:
 *   auto      — the structure model's pick when it is confident, otherwise the
 *               heuristic's. Every song gets a hook; nothing falls back to 0.
 *   heuristic — the no-model pick (biggest loudness lift, on a bar)
 *   preview   — always the whole preview from 0 (kept as an admin override)
 *
 * A picked hook is never played cold: the window starts BUILDUP_MS earlier, on
 * the last bar 1.5–3.5 s before it, so you hear the 2–3 s that lead into it.
 */

export const HOOK_PIPELINE_VERSION = 3;
export const MIN_HOOK_MS = 12_000;
/** A preview hook ends on a line: every LINE_BARS bars counted from the hook's bar. */
export const LINE_BARS = 2;
/** Stay this far clear of the clip's last moment when ending on a line. */
export const TAIL_MARGIN_MS = 250;
export const PREVIEW_MAX_MS = 35_000;
export const LONG_HOOK_MAX_MS = 30_000;
export const CONFIDENT = 0.18;
export const MAX_HOOKS_LONG = 3;
/** Lead-in before a hook: the window opens on a bar 1.5–3.5 s before it. */
export const BUILDUP_MS = 2_500;
export const BUILDUP_MIN_MS = 1_500;
export const BUILDUP_MAX_MS = 3_500;

export type HookPolicy = "auto" | "heuristic" | "preview";
export type HookMethod = "model" | "heuristic" | "preview";

/** runtime config stores numbers: 0 preview, 1 heuristic, 2 auto */
export function policyOf(n: number | undefined): HookPolicy {
  return n === 0 ? "preview" : n === 1 ? "heuristic" : "auto";
}

export type Section = { startMs: number; endMs: number; label: number; score: number };

export type HookAnalysis = {
  durationMs: number;
  downbeatsMs: number[];
  sections: Section[];
  modelStartMs?: number;
  confidence: number;
  heuristicStartMs: number;
};

export type Window = { startMs: number; durationMs: number };

/** One window from `startMs` to the end of the audio, at least MIN_HOOK_MS. */
export function singleWindow(startMs: number, durationMs: number, downbeatsMs: number[]): Window {
  const total = Math.max(0, Math.floor(durationMs));
  if (total <= MIN_HOOK_MS) return { startMs: 0, durationMs: total };
  const latest = total - MIN_HOOK_MS;
  let start = Math.max(0, Math.floor(startMs));
  if (start > latest) {
    const earlier = downbeatsMs.filter((d) => d <= latest);
    start = earlier.length ? Math.max(...earlier) : 0;
  }
  return { startMs: start, durationMs: total - start };
}

/**
 * Where to open a window so the hook arrives with its build-up: the latest bar
 * 1.5–3.5 s before the hook, else 2.5 s before it. A hook at 0 opens at 0.
 */
export function withBuildup(hookMs: number, downbeatsMs: number[]): number {
  const hook = Math.max(0, Math.floor(hookMs));
  if (hook === 0) return 0;
  const lo = hook - BUILDUP_MAX_MS;
  const hi = hook - BUILDUP_MIN_MS;
  const inRange = downbeatsMs.filter((d) => d >= lo && d <= hi);
  const start = inRange.length ? Math.max(...inRange) : hook - BUILDUP_MS;
  return Math.max(0, Math.floor(start));
}

/**
 * The window for a preview: open on the bar 1.5–3.5 s before the hook, close
 * on the last whole line (LINE_BARS bars from the hook's bar) that fits in the
 * clip. Shorter than MIN_HOOK_MS → play out to the clip's end; still too short
 * (a hook in the last seconds) → open earlier, on the latest bar that leaves
 * MIN_HOOK_MS. Mirrored by preview_window in scripts/lib/hookstructure.py.
 */
export function previewWindow(hookMs: number, durationMs: number, downbeatsMs: number[]): Window {
  const total = Math.max(0, Math.floor(durationMs));
  if (total <= MIN_HOOK_MS) return { startMs: 0, durationMs: total };
  const bars = downbeatsMs.filter((d) => d >= 0 && d < total).sort((a, b) => a - b);
  const i0 = bars.findIndex((d) => d >= hookMs - 150);
  const hookBar = i0 >= 0 ? bars[i0] : Math.max(0, hookMs);
  let start = withBuildup(hookBar, bars);
  let end: number | undefined;
  if (i0 >= 0) {
    for (let k = LINE_BARS; i0 + k < bars.length && bars[i0 + k] <= total - TAIL_MARGIN_MS; k += LINE_BARS) {
      end = bars[i0 + k];
    }
  }
  if (end === undefined || end - start < MIN_HOOK_MS) end = total;
  if (end - start < MIN_HOOK_MS) {
    const earlier = bars.filter((d) => d <= total - MIN_HOOK_MS);
    start = earlier.length ? Math.max(...earlier) : total - MIN_HOOK_MS;
  }
  start = Math.max(0, Math.floor(start));
  return { startMs: start, durationMs: Math.floor(end) - start };
}

/** Do any two windows share a moment? The thing v2 got wrong. */
export function anyOverlap(windows: Window[]): boolean {
  const w = [...windows].sort((a, b) => a.startMs - b.startMs);
  return w.some((x, i) => i > 0 && x.startMs < w[i - 1].startMs + w[i - 1].durationMs);
}

export function planHooksV3(a: HookAnalysis, policy: HookPolicy): { method: HookMethod; windows: Window[] } {
  const d = a.durationMs;
  const confident = a.modelStartMs !== undefined && a.confidence >= CONFIDENT;

  if (d <= PREVIEW_MAX_MS) {
    if (policy === "preview") return { method: "preview", windows: [singleWindow(0, d, a.downbeatsMs)] };
    const useModel = policy === "auto" && confident;
    const hook = useModel ? (a.modelStartMs as number) : a.heuristicStartMs;
    return { method: useModel ? "model" : "heuristic", windows: [previewWindow(hook, d, a.downbeatsMs)] };
  }

  // a full song: up to three distinct sections
  const capped = (w: Window): Window => ({ startMs: w.startMs, durationMs: Math.min(w.durationMs, LONG_HOOK_MAX_MS) });
  if (policy === "preview") {
    return { method: "preview", windows: [capped(singleWindow(0, d, a.downbeatsMs))] };
  }
  if (policy === "heuristic" || !confident || a.sections.length === 0) {
    const start = withBuildup(a.heuristicStartMs, a.downbeatsMs);
    return { method: "heuristic", windows: [capped(singleWindow(start, d, a.downbeatsMs))] };
  }
  const picked: { start: number; end: number; label: number }[] = [];
  for (const s of [...a.sections].sort((x, y) => y.score - x.score)) {
    if (picked.length >= MAX_HOOKS_LONG) break;
    const length = Math.min(Math.max(s.endMs - s.startMs, MIN_HOOK_MS), LONG_HOOK_MAX_MS);
    const start = withBuildup(s.startMs, a.downbeatsMs);
    const end = Math.min(start + length, d);
    if (end - start < MIN_HOOK_MS) continue;
    const apart = picked.every((p) => start >= p.end + 5_000 || end <= p.start - 5_000);
    if (!apart) continue;
    if (picked.some((p) => p.label === s.label && Math.abs(p.start - start) < 45_000)) continue;
    picked.push({ start, end, label: s.label });
  }
  if (picked.length === 0) {
    const start = withBuildup(a.heuristicStartMs, a.downbeatsMs);
    return { method: "heuristic", windows: [capped(singleWindow(start, d, a.downbeatsMs))] };
  }
  return { method: "model", windows: picked.map((p) => ({ startMs: p.start, durationMs: p.end - p.start })) };
}

/**
 * Hooks for a track nobody has analysed yet (a fresh chart pull, an import):
 * the whole preview, or for longer audio up to three evenly spaced 20 s
 * sections that never overlap. Replaces v2's 10 s thirds.
 */
export function provisionalWindows(totalMs: number): Window[] {
  const total = Math.max(0, Math.floor(totalMs));
  if (total <= PREVIEW_MAX_MS) return [{ startMs: 0, durationMs: total }];
  const len = 20_000;
  const count = Math.min(MAX_HOOKS_LONG, Math.floor(total / (len + 5_000)));
  if (count <= 1) return [{ startMs: 0, durationMs: Math.min(total, LONG_HOOK_MAX_MS) }];
  const stride = Math.floor((total - len) / (count - 1));
  return Array.from({ length: count }, (_, i) => ({ startMs: i * stride, durationMs: len }));
}

/**
 * Compare a person's marked hook starts with each method's pick. Used by the
 * Hook check page; a method only earns the pipeline if it beats the others.
 *
 *   model       — the structure model's raw pick (0 when it found no structure)
 *   auto        — what policy "auto" picks: the model when confident, else the heuristic
 *   heuristic   — the no-model loudness pick
 *   preview     — always 0, Apple's own excerpt
 *   current     — what the app plays right now for that track
 */
export function scoreMethods(
  rows: { markedStartMs: number; modelStartMs?: number; confidence: number; heuristicStartMs: number; policyStartMs: number }[],
) {
  const stat = (errs: number[]) => ({
    n: errs.length,
    meanAbsErrorS: errs.length ? Math.round((errs.reduce((a, b) => a + b, 0) / errs.length / 1000) * 10) / 10 : null,
    within2s: errs.length ? Math.round((errs.filter((e) => e <= 2_000).length / errs.length) * 100) : null,
  });
  const err = (pick: number, marked: number) => Math.abs(pick - marked);
  const confident = (r: (typeof rows)[number]) => r.modelStartMs !== undefined && r.confidence >= CONFIDENT;
  return {
    model: stat(rows.map((r) => err(r.modelStartMs ?? 0, r.markedStartMs))),
    modelWhenConfident: stat(rows.filter(confident).map((r) => err(r.modelStartMs as number, r.markedStartMs))),
    auto: stat(rows.map((r) => err(confident(r) ? (r.modelStartMs as number) : r.heuristicStartMs, r.markedStartMs))),
    heuristic: stat(rows.map((r) => err(r.heuristicStartMs, r.markedStartMs))),
    preview: stat(rows.map((r) => err(0, r.markedStartMs))),
    current: stat(rows.map((r) => err(r.policyStartMs, r.markedStartMs))),
  };
}

/** Labels needed before the evaluation is allowed to recommend anything. */
export const MIN_LABELS = 20;

/**
 * Which policy the labels support. The structure model (auto) has to beat
 * both simpler options on mean error AND not lose on within-2 s; the
 * heuristic likewise has to beat the preview. Ties go to the simpler option,
 * so the model is used only when it actually wins.
 */
export function recommendPolicy(scores: ReturnType<typeof scoreMethods>): {
  policy: HookPolicy | null;
  reason: string;
} {
  const n = scores.preview.n;
  if (n < MIN_LABELS) return { policy: null, reason: `need ${MIN_LABELS - n} more marked songs` };
  const e = (s: { meanAbsErrorS: number | null }) => s.meanAbsErrorS ?? Infinity;
  const w = (s: { within2s: number | null }) => s.within2s ?? 0;
  const beats = (a: typeof scores.auto, b: typeof scores.auto) => e(a) < e(b) && w(a) >= w(b);
  if (beats(scores.auto, scores.heuristic) && beats(scores.auto, scores.preview)) {
    return { policy: "auto", reason: `model wins: ${e(scores.auto)} s mean error, ${w(scores.auto)} % within 2 s` };
  }
  if (beats(scores.heuristic, scores.preview)) {
    return { policy: "heuristic", reason: `heuristic beats the model and the preview: ${e(scores.heuristic)} s mean error` };
  }
  return { policy: "preview", reason: "neither detector beats playing the preview from 0" };
}

/** Which pipeline made a hook, from its createdBy stamp. */
export function methodOf(createdBy: string): string {
  const v3 = /^analyzer:v\d+:(\w+)$/.exec(createdBy);
  if (v3) return v3[1];
  if (createdBy === "analyzer") return "legacy-analyzer";
  if (createdBy.startsWith("system:")) return "legacy-provisional";
  return "human";
}

/**
 * Catalogue-wide hook health: lengths, repeated seconds, method mix. The
 * "before" numbers v3 was built against were: 8.3–10 s hooks (median 9.7),
 * 76 % of tracks replaying the same seconds.
 */
export function measureHooks(hooks: { trackId: string; startMs: number; durationMs: number; createdBy: string }[]) {
  const byTrack = new Map<string, Window[]>();
  const methods: Record<string, number> = {};
  const lengths: number[] = [];
  for (const h of hooks) {
    const list = byTrack.get(h.trackId) ?? [];
    // method mix is per track: what made the hooks a listener hears
    if (list.length === 0) methods[methodOf(h.createdBy)] = (methods[methodOf(h.createdBy)] ?? 0) + 1;
    list.push({ startMs: h.startMs, durationMs: h.durationMs });
    byTrack.set(h.trackId, list);
    lengths.push(h.durationMs);
  }
  lengths.sort((a, b) => a - b);
  const q = (p: number) => (lengths.length ? Math.round(lengths[Math.min(lengths.length - 1, Math.floor(p * lengths.length))] / 100) / 10 : null);
  const tracks = byTrack.size;
  const repeated = [...byTrack.values()].filter(anyOverlap).length;
  const perTrack: Record<string, number> = {};
  for (const list of byTrack.values()) perTrack[list.length] = (perTrack[list.length] ?? 0) + 1;
  return {
    tracks,
    hooks: hooks.length,
    lengthS: { min: q(0), p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) },
    shorterThan15s: lengths.length ? Math.round((lengths.filter((l) => l < MIN_HOOK_MS).length / lengths.length) * 1000) / 10 : 0,
    repeatedSecondsPct: tracks ? Math.round((repeated / tracks) * 1000) / 10 : 0,
    hooksPerTrack: perTrack,
    methods,
  };
}
