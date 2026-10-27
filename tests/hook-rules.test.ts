import { describe, expect, it } from "vitest";
import {
  anyOverlap,
  CONFIDENT,
  measureHooks,
  methodOf,
  MIN_HOOK_MS,
  MIN_LABELS,
  planHooksV3,
  policyOf,
  previewWindow,
  provisionalWindows,
  recommendPolicy,
  scoreMethods,
  singleWindow,
  withBuildup,
  type HookAnalysis,
} from "../convex/hookRules";
import { distinctHooks, FADE_OUT_S, hookGain, hookTiming } from "../src/lib/hookPlayback";

/**
 * Hook recognition v3. The complaint that started it: hooks were ~10 s, three
 * of them were one hook cut into overlapping pieces, and they didn't give you
 * the song. These pin the rules that make that impossible.
 */

const bars = (to: number, every = 2000) => Array.from({ length: Math.floor(to / every) + 1 }, (_, i) => i * every);

function preview(over: Partial<HookAnalysis> = {}): HookAnalysis {
  return {
    durationMs: 30_000,
    downbeatsMs: bars(30_000),
    sections: [
      { startMs: 0, endMs: 12_000, label: 0, score: 0.2 },
      { startMs: 12_000, endMs: 30_000, label: 1, score: 0.8 },
    ],
    modelStartMs: 12_000,
    confidence: 0.4,
    heuristicStartMs: 10_000,
    ...over,
  };
}

describe("planHooksV3 on a preview", () => {
  it("gives exactly one hook: from the bar before the chorus to the end of a line", () => {
    const { method, windows } = planHooksV3(preview(), "auto");
    expect(method).toBe("model");
    // chorus at 12 s: opens on the 10 s bar (build-up), closes on the 28 s bar,
    // the last 2-bar line that fits before Apple's clip ends at 30 s
    expect(windows).toEqual([{ startMs: 10_000, durationMs: 18_000 }]);
  });

  it("never plays a fixed 10 s slice, and never runs past the clip", () => {
    for (const policy of ["auto", "heuristic", "preview"] as const) {
      for (const start of [0, 5_000, 14_000, 20_000, 28_000]) {
        const { windows } = planHooksV3(preview({ modelStartMs: start, heuristicStartMs: start }), policy);
        expect(windows).toHaveLength(1);
        expect(windows[0].durationMs).toBeGreaterThanOrEqual(MIN_HOOK_MS);
        expect(windows[0].startMs + windows[0].durationMs).toBeLessThanOrEqual(30_000);
      }
    }
  });

  it("opens a late hook earlier, on the last bar that still leaves the minimum", () => {
    // hook at 24 s: one more line wouldn't make 12 s, so it plays out to the end from 18 s
    const { windows } = planHooksV3(preview({ modelStartMs: 24_000 }), "auto");
    expect(windows).toEqual([{ startMs: 18_000, durationMs: 12_000 }]);
  });

  it("uses the heuristic's hook when the model isn't confident, never the whole preview", () => {
    const { method, windows } = planHooksV3(preview({ confidence: CONFIDENT - 0.01 }), "auto");
    expect(method).toBe("heuristic");
    // heuristic hook at 10 s: opened on the 8 s bar, closed on the 26 s line
    expect(windows).toEqual([{ startMs: 8_000, durationMs: 18_000 }]);
  });

  it("uses the heuristic's hook when the model found no structure", () => {
    const { method, windows } = planHooksV3(preview({ modelStartMs: undefined, sections: [] }), "auto");
    expect(method).toBe("heuristic");
    expect(windows[0].startMs).toBe(8_000);
  });

  it("under auto, every heard song starts at a hook, not at 0", () => {
    for (const confidence of [0, 0.05, 0.1, CONFIDENT - 0.01, CONFIDENT, 0.6]) {
      for (const hook of [4_000, 9_000, 13_000]) {
        const { windows } = planHooksV3(preview({ confidence, modelStartMs: hook, heuristicStartMs: hook }), "auto");
        expect(windows[0].startMs).toBeGreaterThan(0);
        expect(windows[0].startMs).toBeLessThan(hook);
        expect(hook - windows[0].startMs).toBeLessThanOrEqual(3_500);
      }
    }
  });

  it("follows the admin's policy", () => {
    expect(planHooksV3(preview(), "heuristic")).toEqual({
      method: "heuristic",
      windows: [{ startMs: 8_000, durationMs: 18_000 }],
    });
    expect(planHooksV3(preview(), "preview").windows).toEqual([{ startMs: 0, durationMs: 30_000 }]);
  });

  it("plays a clip no longer than the minimum whole", () => {
    expect(planHooksV3(preview({ durationMs: 12_000 }), "auto").windows).toEqual([{ startMs: 0, durationMs: 12_000 }]);
  });
});

describe("planHooksV3 on a full song", () => {
  const full: HookAnalysis = {
    durationMs: 200_000,
    downbeatsMs: bars(200_000),
    sections: [
      { startMs: 0, endMs: 20_000, label: 0, score: 0.1 },
      { startMs: 20_000, endMs: 50_000, label: 1, score: 0.3 },
      { startMs: 50_000, endMs: 72_000, label: 2, score: 0.9 },
      { startMs: 72_000, endMs: 100_000, label: 1, score: 0.35 },
      { startMs: 100_000, endMs: 122_000, label: 2, score: 0.85 },
      { startMs: 122_000, endMs: 140_000, label: 3, score: 0.6 },
      { startMs: 140_000, endMs: 170_000, label: 2, score: 0.8 },
      { startMs: 170_000, endMs: 200_000, label: 4, score: 0.2 },
    ],
    modelStartMs: 50_000,
    confidence: 0.5,
    heuristicStartMs: 50_000,
  };

  it("picks up to three distinct sections, each 15-30 s, never overlapping", () => {
    const { method, windows } = planHooksV3(full, "auto");
    expect(method).toBe("model");
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows.length).toBeLessThanOrEqual(3);
    expect(anyOverlap(windows)).toBe(false);
    for (const w of windows) {
      expect(w.durationMs).toBeGreaterThanOrEqual(MIN_HOOK_MS);
      expect(w.durationMs).toBeLessThanOrEqual(30_000);
    }
  });

  it("doesn't offer the same chorus twice in a row", () => {
    const { windows } = planHooksV3(full, "auto");
    const starts = windows.map((w) => w.startMs);
    // 50 s and 100 s are both label 2 but 50 s apart, so both may stay;
    // what must never happen is two picks inside one section
    expect(new Set(starts).size).toBe(starts.length);
    // the 50 s chorus, opened on the 48 s bar
    expect(starts[0]).toBe(48_000);
  });

  it("gives one capped window at the heuristic's hook when it isn't confident", () => {
    expect(planHooksV3({ ...full, confidence: 0 }, "auto")).toEqual({
      method: "heuristic",
      windows: [{ startMs: 48_000, durationMs: 30_000 }],
    });
  });
});

describe("the preview window (ends on a line, not where Apple cut the clip)", () => {
  const bars2 = bars(30_000);

  it("ends on the last whole 2-bar line that fits", () => {
    // hook bar 8 s; lines end at 12, 16, 20, 24, 28; 28 is the last before 29.75 s
    expect(previewWindow(8_000, 30_000, bars2)).toEqual({ startMs: 6_000, durationMs: 22_000 });
  });

  it("counts lines from the hook's own bar, not from the start of the clip", () => {
    const odd = Array.from({ length: 15 }, (_, i) => 1_000 + i * 2_000); // bars at 1, 3, 5 … 29 s
    // hook bar 9 s; lines end at 13, 17, 21, 25, 29 (29 ≤ 29.75)
    expect(previewWindow(9_000, 30_000, odd)).toEqual({ startMs: 7_000, durationMs: 22_000 });
  });

  it("plays out to the clip's end when a whole line would leave it too short", () => {
    // hook 18 s: lines end at 22, 26 → 16..26 is only 10 s, so it runs to 30 s
    expect(previewWindow(18_000, 30_000, bars2)).toEqual({ startMs: 16_000, durationMs: 14_000 });
  });

  it("a hook in the last seconds opens earlier rather than playing 5 s", () => {
    expect(previewWindow(27_000, 30_000, bars2)).toEqual({ startMs: 18_000, durationMs: 12_000 });
  });

  it("works without any detected bars", () => {
    expect(previewWindow(10_000, 30_000, [])).toEqual({ startMs: 7_500, durationMs: 22_500 });
    expect(previewWindow(25_000, 30_000, [])).toEqual({ startMs: 18_000, durationMs: 12_000 });
  });

  it("a preview that opens on its hook starts at 0", () => {
    expect(previewWindow(0, 30_000, bars2)).toEqual({ startMs: 0, durationMs: 28_000 });
  });
});

describe("the build-up before a hook", () => {
  it("opens on the latest bar 1.5-3.5 s before the hook", () => {
    expect(withBuildup(12_000, bars(30_000))).toBe(10_000);
    expect(withBuildup(12_700, bars(30_000))).toBe(10_000);
  });

  it("opens 2.5 s early when no bar falls in that range", () => {
    expect(withBuildup(12_000, [])).toBe(9_500);
  });

  it("never goes below 0, and a hook at 0 stays at 0", () => {
    expect(withBuildup(0, bars(30_000))).toBe(0);
    expect(withBuildup(1_000, [])).toBe(0);
  });
});

describe("provisional hooks (before anything has listened)", () => {
  it("is the whole preview, once", () => {
    expect(provisionalWindows(30_000)).toEqual([{ startMs: 0, durationMs: 30_000 }]);
  });

  it("is distinct 20 s sections for a full upload", () => {
    const w = provisionalWindows(180_000);
    expect(w).toHaveLength(3);
    expect(anyOverlap(w)).toBe(false);
  });
});

describe("singleWindow and policyOf", () => {
  it("never starts past the audio", () => {
    const w = singleWindow(40_000, 30_000, []);
    expect(w).toEqual({ startMs: 0, durationMs: 30_000 });
  });

  it("maps the runtime number to a policy, defaulting to auto", () => {
    expect(policyOf(0)).toBe("preview");
    expect(policyOf(1)).toBe("heuristic");
    expect(policyOf(2)).toBe("auto");
    expect(policyOf(undefined)).toBe("auto");
  });
});

describe("the Hook check evaluation", () => {
  const row = (marked: number, model: number | undefined, conf: number, heur: number) => ({
    markedStartMs: marked,
    modelStartMs: model,
    confidence: conf,
    heuristicStartMs: heur,
    policyStartMs: 0,
  });

  it("scores each method by mean error and hits within 2 s", () => {
    const s = scoreMethods([row(12_000, 12_500, 0.5, 4_000), row(0, undefined, 0, 0), row(20_000, 10_000, 0.1, 19_000)]);
    expect(s.preview).toEqual({ n: 3, meanAbsErrorS: 10.7, within2s: 33 });
    expect(s.heuristic.within2s).toBe(67);
    expect(s.modelWhenConfident.n).toBe(1);
    // auto = model when confident (row 1), else the heuristic (rows 2, 3)
    expect(s.auto.meanAbsErrorS).toBe(0.5);
  });

  it("recommends nothing until there are enough marks", () => {
    const s = scoreMethods([row(12_000, 12_000, 0.5, 0)]);
    expect(recommendPolicy(s).policy).toBeNull();
  });

  it("uses the model only when it beats both simpler options", () => {
    const wins = Array.from({ length: MIN_LABELS }, () => row(12_000, 12_000, 0.5, 4_000));
    expect(recommendPolicy(scoreMethods(wins)).policy).toBe("auto");
    const loses = Array.from({ length: MIN_LABELS }, () => row(0, 12_000, 0.5, 4_000));
    expect(recommendPolicy(scoreMethods(loses)).policy).toBe("preview");
    const heuristic = Array.from({ length: MIN_LABELS }, () => row(8_000, 20_000, 0.5, 8_000));
    expect(recommendPolicy(scoreMethods(heuristic)).policy).toBe("heuristic");
  });
});

describe("catalogue hook health", () => {
  it("counts lengths, repeated seconds and the method behind each song", () => {
    const m = measureHooks([
      { trackId: "a", startMs: 0, durationMs: 10_000, createdBy: "analyzer" },
      { trackId: "a", startMs: 5_000, durationMs: 10_000, createdBy: "analyzer" },
      { trackId: "b", startMs: 12_000, durationMs: 18_000, createdBy: "analyzer:v3:model" },
      { trackId: "c", startMs: 0, durationMs: 30_000, createdBy: "user_123" },
    ]);
    expect(m.tracks).toBe(3);
    expect(m.repeatedSecondsPct).toBe(33.3);
    expect(m.shorterThan15s).toBe(50);
    expect(m.methods).toEqual({ "legacy-analyzer": 1, model: 1, human: 1 });
    expect(methodOf("system:backfill")).toBe("legacy-provisional");
  });
});

describe("hook playback (shared by web and mobile)", () => {
  it("fades a hook out over its last 1.5 s instead of stopping dead", () => {
    expect(hookGain(5, 20)).toBe(1);
    expect(hookGain(20 - FADE_OUT_S, 20)).toBe(1);
    expect(hookGain(20 - FADE_OUT_S / 2, 20)).toBeCloseTo(0.5);
    expect(hookGain(20, 20)).toBe(0);
  });

  it("fades in over a moment so a mid-song start doesn't click, and is silent before the window", () => {
    expect(hookGain(0, 20)).toBe(0);
    expect(hookGain(0.06, 20)).toBeCloseTo(0.5);
    expect(hookGain(-3, 20)).toBe(0);
  });

  it("an open-ended window only fades in", () => {
    expect(hookGain(10, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("drops a window that would replay seconds already heard", () => {
    const kept = distinctHooks([
      { startMs: 0, durationMs: 10_000 },
      { startMs: 5_000, durationMs: 10_000 },
      { startMs: 10_000, durationMs: 10_000 },
    ]);
    expect(kept.map((h) => h.startMs)).toEqual([0, 10_000]);
  });

  it("cuts a window at the end of the audio so the hook actually finishes", () => {
    const t = hookTiming({ startMs: 12_000, durationMs: 18_000 }, 29.7, 29.7);
    expect(t.lengthS).toBeCloseTo(17.7);
    expect(t.done).toBe(true);
    expect(t.progress).toBe(1);
  });

  it("borrows the file's length for the open-ended fallback, and waits for it", () => {
    const whole = { startMs: 0, durationMs: Number.POSITIVE_INFINITY };
    expect(hookTiming(whole, 3, NaN).done).toBe(false);
    expect(hookTiming(whole, 15, 30).progress).toBe(0.5);
  });
});
