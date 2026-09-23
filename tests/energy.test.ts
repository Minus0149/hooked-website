import { describe, expect, it } from "vitest";
// @ts-expect-error - the analyser is plain ESM for node; tests aren't typechecked
import { trackEnergy } from "../scripts/lib/hook-detector.mjs";

/**
 * Energy is the one half of the mood plane that can be measured instead of
 * guessed, and it is measured from curves the hook finder already computes —
 * so it costs nothing and nobody would notice if it silently became a constant.
 * That is the failure worth guarding: a number that is always 0.5 still ranks,
 * still saves, and quietly turns "measured" back into "assumed".
 */

const SR = 22050;
const HOP = 256;
const FPS = SR / HOP;

/** A loudness curve at a given dBFS, as Int16 RMS. */
const loudness = (dbfs: number, seconds = 30) =>
  Array.from({ length: seconds }, () => Math.pow(10, dbfs / 20) * 32768);

/** An onset envelope with `perSecond` peaks a second. */
function onsets(perSecond: number, seconds = 30): Float32Array {
  const frames = Math.round(FPS * seconds);
  const env = new Float32Array(frames);
  if (perSecond <= 0) return env;
  const every = Math.max(2, Math.round(FPS / perSecond));
  for (let i = every; i < frames - 1; i += every) env[i] = 1;
  return env;
}

describe("measuring how activating a track sounds", () => {
  it("hears a loud, busy record as high energy", () => {
    const energy = trackEnergy({ rms: loudness(-9), onsets: onsets(5) });
    expect(energy).toBeGreaterThan(0.8);
  });

  it("hears a quiet, sparse one as low energy", () => {
    const energy = trackEnergy({ rms: loudness(-32), onsets: onsets(0.5) });
    expect(energy).toBeLessThan(0.2);
  });

  it("puts a normal pop master in the middle, not at an extreme", () => {
    const energy = trackEnergy({ rms: loudness(-20), onsets: onsets(2.5) });
    expect(energy).toBeGreaterThan(0.25);
    expect(energy).toBeLessThan(0.75);
  });

  it("rises with loudness, everything else held still", () => {
    const quiet = trackEnergy({ rms: loudness(-28), onsets: onsets(2) });
    const mid = trackEnergy({ rms: loudness(-18), onsets: onsets(2) });
    const loud = trackEnergy({ rms: loudness(-10), onsets: onsets(2) });
    expect(quiet).toBeLessThan(mid);
    expect(mid).toBeLessThan(loud);
  });

  it("rises with rhythm at the same volume — that's a separate axis", () => {
    const still = trackEnergy({ rms: loudness(-18), onsets: onsets(0.4) });
    const busy = trackEnergy({ rms: loudness(-18), onsets: onsets(5) });
    expect(busy).toBeGreaterThan(still + 0.15);
  });

  it("ignores one clipped transient in an otherwise quiet track", () => {
    const rms = loudness(-30);
    rms[7] = 32767; // a slammed drum, or a decode artefact
    const spiked = trackEnergy({ rms, onsets: onsets(1) });
    const clean = trackEnergy({ rms: loudness(-30), onsets: onsets(1) });
    expect(spiked).toBeCloseTo(clean, 3);
  });

  it("stays inside the plane", () => {
    for (const db of [-60, -40, -20, -6, -0.1]) {
      for (const rate of [0, 1, 40]) {
        const energy = trackEnergy({ rms: loudness(db), onsets: onsets(rate) });
        expect(energy).toBeGreaterThanOrEqual(0);
        expect(energy).toBeLessThanOrEqual(1);
      }
    }
  });

  it("says it doesn't know rather than guessing", () => {
    expect(trackEnergy(null)).toBeNull();
    expect(trackEnergy({ rms: [], onsets: onsets(3) })).toBeNull();
    expect(trackEnergy({ rms: loudness(-12), onsets: new Float32Array(0) })).toBeNull();
  });
});
