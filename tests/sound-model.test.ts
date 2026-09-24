import { describe, expect, it } from "vitest";
// @ts-expect-error - plain ESM for node; tests aren't typechecked
import * as M from "../scripts/lib/sound-model.mjs";
import { soundOf } from "../src/data/sound";

/** The analyser's maths, without a model or a network. */
describe("compressing what CLAP heard", () => {
  // three clusters in 8-d, so the first components have something to find
  const rows: number[][] = [];
  for (let n = 0; n < 60; n++) {
    const c = n % 3;
    rows.push(Array.from({ length: 8 }, (_, i) => (i === c ? 1 : 0) + Math.sin(n * 7 + i) * 0.05));
  }

  it("finds orthogonal unit directions, the same ones every run", () => {
    const mu = M.mean(rows);
    const centred = rows.map((r: number[]) => r.map((x: number, i: number) => x - mu[i]));
    const a = M.principalComponents(centred, 3, 40);
    const b = M.principalComponents(centred, 3, 40);
    expect(a).toEqual(b);
    for (const v of a) expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(Math.abs(M.dot(a[0], a[1]))).toBeLessThan(1e-3);
  });

  it("packs a vector into the 44 characters the client unpacks", () => {
    const vec = M.unit(Array.from({ length: 32 }, (_, i) => (i === 4 ? 1 : 0.1)));
    const packed = M.packSound(vec);
    expect(packed).toHaveLength(44);
    const back = soundOf({ sound: packed })!;
    expect(M.dot(Array.from(back), vec)).toBeGreaterThan(0.999);
  });
});

describe("reading a mood from the audio", () => {
  it("judges each mood against the catalogue, so a prompt that flatters every song doesn't win", () => {
    // 'party' scores high for everything; this song is only unusual on 'tender'
    const catalogue = Array.from({ length: 50 }, (_, n) => [0.3, 0.6, 0.3, 0.3, 0.2 + (n % 5) * 0.01, 0.1]);
    const stats = M.fitMoodStats(catalogue);
    const song = [0.3, 0.6, 0.3, 0.3, 0.35, 0.1];
    const probs = M.calibrateMoods(song, stats);
    expect(M.MOOD_ORDER[probs.indexOf(Math.max(...probs))]).toBe("tender");
    expect(probs.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(1, 2);
  });

  it("keeps sung vs instrumental in 0..1", () => {
    const stats = { mean: 0.05, std: 0.04 };
    expect(M.calibrateVocal(0.2, stats)).toBeGreaterThan(0.9);
    expect(M.calibrateVocal(-0.1, stats)).toBeLessThan(0.1);
  });
});
