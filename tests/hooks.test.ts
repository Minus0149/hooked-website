import { describe, expect, it } from "vitest";
// @ts-expect-error - the analyser is plain ESM for node; tests aren't typechecked
import { planHooks } from "../scripts/lib/hook-detector.mjs";

/**
 * The hook finder decides where every song starts playing, which is the whole
 * product. Its first version could only ever answer "0, 10, 20": three
 * ten-second windows that may not overlap fit a thirty-second preview one way,
 * so on the live catalogue a third of the top hooks started in the first five
 * seconds and a quarter ran into the preview's fade-out. These build songs
 * with a known structure and check the answer lands where a listener would.
 */

const SR = 22050;
const HOP = 256;
const FPS = SR / HOP;

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Section = { from: number; to: number; level: number; repeats?: boolean };

/**
 * A 30 s preview made of sections. A repeating section tiles one 4-second
 * phrase — that is what a chorus looks like to the repetition score — and
 * everything else is fresh noise that never comes round again.
 */
function song(sections: Section[], seconds = 30) {
  const rand = prng(7);
  const frames = Math.round(FPS * seconds);
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);
  const phraseLen = Math.round(FPS * 4);
  const phrase = Array.from({ length: phraseLen }, () => [rand(), rand(), rand()]);
  for (let f = 0; f < frames; f++) {
    const s = f / FPS;
    const sec = sections.find((x) => s >= x.from && s < x.to);
    if (!sec) continue;
    const v = sec.repeats ? phrase[f % phraseLen] : [rand(), rand(), rand()];
    low[f] = v[0] * sec.level;
    mid[f] = v[1] * sec.level;
    high[f] = v[2] * sec.level;
  }
  const rms = Array.from({ length: seconds }, (_, s) => {
    const sec = sections.find((x) => s >= x.from && s < x.to);
    return (sec?.level ?? 0) * 9000;
  });
  return { rms, bands: { low, mid, high }, durationMs: seconds * 1000, fallbackMs: 30000 };
}

type Hook = { startMs: number; durationMs: number };

describe("planHooks", () => {
  // quiet intro, a loud chorus, a verse, the preview's fade
  const introThenChorus = song([
    { from: 0, to: 11, level: 0.25 },
    { from: 11, to: 21, level: 1, repeats: true },
    { from: 21, to: 27, level: 0.55 },
    { from: 27, to: 30, level: 0.04 },
  ]);

  it("starts the top hook where the chorus lands", () => {
    const [top] = planHooks(introThenChorus) as Hook[];
    expect(top.startMs).toBeGreaterThanOrEqual(9500);
    expect(top.startMs).toBeLessThanOrEqual(12500);
  });

  it("never pads the list with the intro just to have three", () => {
    const hooks = planHooks(introThenChorus) as Hook[];
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    for (const h of hooks) expect(h.startMs).toBeGreaterThanOrEqual(8000);
  });

  it("does not let a hook run into the fade-out", () => {
    for (const h of planHooks(introThenChorus) as Hook[]) {
      expect(h.startMs + h.durationMs).toBeLessThanOrEqual(27500);
    }
  });

  it("keeps a chorus that opens the preview instead of refusing time zero", () => {
    const chorusFirst = song([
      { from: 0, to: 10, level: 1, repeats: true },
      { from: 10, to: 20, level: 0.45 },
      { from: 20, to: 27, level: 1, repeats: true },
      { from: 27, to: 30, level: 0.04 },
    ]);
    const [top] = planHooks(chorusFirst) as Hook[];
    // v3: the chorus at 20 s leaves under 15 s of audio, so it can't open a
    // hook of its own — the answer is the chorus at the top, running on
    // through the second chorus to the end
    expect(top.startMs).toBeLessThanOrEqual(1500);
    expect(top.durationMs).toBeGreaterThanOrEqual(15000);
  });

  it("gives a preview exactly one hook, at least 15 s, running to the end of the usable audio", () => {
    const hooks = planHooks(introThenChorus) as Hook[];
    expect(hooks).toHaveLength(1);
    const [h] = hooks;
    expect(h.durationMs).toBeGreaterThanOrEqual(15000);
    // the fade starts at 27 s; the hook runs up to it, not a fixed slice short of it
    expect(h.startMs + h.durationMs).toBeGreaterThanOrEqual(26000);
  });

  it("pulls a late chorus back so the hook still lasts 15 s", () => {
    const lateChorus = song([
      { from: 0, to: 22, level: 0.3 },
      { from: 22, to: 30, level: 1, repeats: true },
    ]);
    const [h] = planHooks(lateChorus) as Hook[];
    expect(h.durationMs).toBeGreaterThanOrEqual(15000);
    expect(h.startMs + h.durationMs).toBeLessThanOrEqual(30000);
  });

  it("gives a full song up to three distinct, non-overlapping sections of at least 15 s", () => {
    const full = song(
      [
        { from: 0, to: 20, level: 0.3 },
        { from: 20, to: 45, level: 1, repeats: true },
        { from: 45, to: 80, level: 0.5 },
        { from: 80, to: 110, level: 1, repeats: true },
        { from: 110, to: 150, level: 0.55 },
        { from: 150, to: 180, level: 1, repeats: true },
      ],
      180,
    );
    const hooks = planHooks(full) as Hook[];
    expect(hooks.length).toBeGreaterThanOrEqual(2);
    expect(hooks.length).toBeLessThanOrEqual(3);
    const sorted = [...hooks].sort((a, b) => a.startMs - b.startMs);
    for (const [i, h] of sorted.entries()) {
      expect(h.durationMs).toBeGreaterThanOrEqual(15000);
      if (i > 0) expect(h.startMs).toBeGreaterThanOrEqual(sorted[i - 1].startMs + sorted[i - 1].durationMs);
    }
  });

  it("still answers for a track with no structure at all", () => {
    const flat = song([{ from: 0, to: 30, level: 0.6 }]);
    const hooks = planHooks(flat) as Hook[];
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    for (const h of hooks) expect(h.startMs + h.durationMs).toBeLessThanOrEqual(30000);
  });
});
