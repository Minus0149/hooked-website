import { describe, expect, it } from "vitest";
import { MOODS, moodPlaylistName } from "../src/data/mood";
import { FACE_IDLE, faceIdle } from "../src/components/faceMotion";

describe("holding + for a mood playlist", () => {
  it("names one playlist per mood, so picking the face again reuses it", () => {
    const names = MOODS.map((m) => moodPlaylistName(m.id));
    expect(new Set(names).size).toBe(MOODS.length);
    expect(moodPlaylistName("party")).toBe("Party mix");
  });
});

describe("the faces in the ring", () => {
  it("each move their own way — six copies of one bob read as a spinner", () => {
    const moves = MOODS.map((m) => JSON.stringify(FACE_IDLE[m.id]));
    expect(new Set(moves).size).toBe(MOODS.length);
  });

  it("loop forever, out of phase with each other", () => {
    const a = faceIdle("party", 0, false).transition;
    const b = faceIdle("party", 1, false).transition;
    expect(a.repeat).toBe(Infinity);
    expect(a.delay).not.toBe(b.delay);
  });

  it("speed up on the face you're aiming at", () => {
    expect(faceIdle("sleepy", 0, true).transition.duration).toBeLessThan(
      faceIdle("sleepy", 0, false).transition.duration,
    );
  });
});
