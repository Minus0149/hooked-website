import { describe, expect, it } from "vitest";
import { SOUND_DIMS, soundOf, soundScore, soundTaste, soundsLike } from "../src/data/sound";
import { ARTIST_GAP, NO_STEER, rankPool, spreadArtists } from "../src/data/ranking";
import { moodById, moodFit } from "../src/data/mood";
import type { Track } from "../src/types";

/** Pack a direction the way scripts/analyze-sound.mjs does: 32 signed bytes, base64. */
function pack(dir: number[]): string {
  const v = Array.from({ length: SOUND_DIMS }, (_, i) => dir[i] ?? 0);
  const n = Math.hypot(...v) || 1;
  const bytes = Uint8Array.from(v.map((x) => (Math.round((x / n) * 127) + 256) % 256));
  return Buffer.from(bytes).toString("base64");
}
const axis = (i: number, j?: number) => {
  const d = new Array(SOUND_DIMS).fill(0);
  d[i] = 1;
  if (j !== undefined) d[j] = 1;
  return d;
};
let n = 0;
const track = (sound: string | undefined, artist = `a${n}`, extra: Partial<Track> = {}): Track => ({
  id: `t${n++}`, title: "", artist, album: "", artwork: `art${n}`, previewUrl: "", durationMs: 30000,
  genre: "pop", accent: "#fff", sound, ...extra,
});

describe("what a song sounds like", () => {
  it("decodes the analyser's 44 characters back into a unit vector", () => {
    const v = soundOf({ sound: pack(axis(3)) })!;
    expect(v).toHaveLength(SOUND_DIMS);
    expect(v[3]).toBeCloseTo(1, 2);
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
  });

  it("says unknown rather than guessing for an unanalysed or corrupt song", () => {
    expect(soundOf({})).toBeNull();
    expect(soundOf({ sound: "abc" })).toBeNull();
  });

  it("hears two songs as alike when they point the same way", () => {
    expect(soundsLike({ sound: pack(axis(0)) }, { sound: pack(axis(0, 1)) })!).toBeGreaterThan(0.6);
    expect(soundsLike({ sound: pack(axis(0)) }, { sound: pack(axis(5)) })!).toBeCloseTo(0, 2);
  });
});

describe("a listener's ear", () => {
  const kept = [track(pack(axis(0))), track(pack(axis(0, 1)))];
  const buried = track(pack(axis(7)));
  const catalog = [...kept, buried];

  it("leans toward what they keep and away from what they bury", () => {
    const taste = soundTaste({ saved: kept, buried: [buried.id], skipped: [], catalog })!;
    expect(soundScore(taste, { sound: pack(axis(0)) })).toBeGreaterThan(0.5);
    expect(soundScore(taste, { sound: pack(axis(7)) })).toBeLessThan(0);
  });

  it("has no opinion before a single kept song has been heard", () => {
    expect(soundTaste({ saved: [], buried: [buried.id], skipped: [], catalog })).toBeNull();
    expect(soundTaste({ saved: [track(undefined)], buried: [], skipped: [], catalog })).toBeNull();
  });

  it("trusts itself more as evidence grows", () => {
    const few = soundTaste({ saved: kept.slice(0, 1), buried: [], skipped: [], catalog })!;
    const more = soundTaste({ saved: kept, buried: [buried.id], skipped: [], catalog })!;
    expect(more.confidence).toBeGreaterThan(few.confidence);
    expect(more.confidence).toBeLessThanOrEqual(1);
  });

  it("pulls songs that sound like their keeps forward in the deck", () => {
    const taste = soundTaste({ saved: kept, buried: [], skipped: [], catalog })!;
    const full = { ...taste, confidence: 1 };
    const alike = track(pack(axis(0)));
    const pool = [...Array.from({ length: 30 }, () => track(pack(axis(9)))), alike];
    let wins = 0;
    for (let r = 0; r < 60; r++) {
      const ranked = rankPool(pool, { ...NO_STEER, sound: full, soundStrength: 25 });
      if (ranked.slice(0, 10).includes(alike)) wins++;
    }
    expect(wins).toBeGreaterThan(50);
  });
});

describe("variety", () => {
  it(`never deals the same artist twice within ${ARTIST_GAP} cards when it can avoid it`, () => {
    const deck = spreadArtists(["x", "x", "x", "y", "z", "w", "v"].map((a) => track(undefined, a)));
    for (let i = 1; i < deck.length; i++) {
      const window = deck.slice(Math.max(0, i - ARTIST_GAP + 1), i).map((t) => t.artist);
      if (i < 6) expect(window).not.toContain(deck[i].artist);
    }
  });
});

describe("the audio's own reading of a mood", () => {
  const tender = moodById("tender")!;
  it("counts, between the crowd and the genre string", () => {
    // filed as pop (not a tender genre), but the audio says tender
    const sadPop = { genre: "pop", audioMood: [0.05, 0.05, 0.1, 0.1, 0.6, 0.1] };
    const plainPop = { genre: "pop" };
    expect(moodFit(sadPop, tender)).toBeGreaterThan(moodFit(plainPop, tender));
  });
  it("lets one song answer two moods", () => {
    // bittersweet: strongly sunny and strongly tender, per the analyser
    const bittersweet = { genre: "pop", audioMood: [0.1, 0.15, 0.8, 0.3, 0.78, 0.2] };
    const plainPop = { genre: "pop" };
    const sunny = moodById("sunny")!;
    expect(moodFit(bittersweet, tender)).toBeGreaterThan(moodFit(plainPop, tender));
    expect(moodFit(bittersweet, sunny)).toBeGreaterThan(moodFit({ ...plainPop, audioMood: [0.1, 0.15, 0.2, 0.3, 0.78, 0.2] }, sunny));
  });
  it("ignores a malformed reading rather than trusting it", () => {
    expect(moodFit({ genre: "pop", audioMood: [1, 2] }, tender)).toBe(moodFit({ genre: "pop" }, tender));
  });
});
