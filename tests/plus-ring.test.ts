import { describe, expect, it } from "vitest";
import { MOODS, moodAtPush, moodPlaylistName, PLUS_DOWN_GAIN } from "../src/data/mood";
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

/**
 * The + sits near the bottom of the screen, so there is far less room to drag
 * down than up; a downward push on its ring counts for more (PLUS_DOWN_GAIN).
 */
describe("the + ring's downward reach", () => {
  const DEAD = 38;
  it("picks a lower face from a short drag down that wouldn't clear the dead zone upward", () => {
    // 25px straight down: past the dead zone only with the gain
    expect(moodAtPush(0, 25, DEAD)).toBeNull();
    expect(moodAtPush(0, 25, DEAD, PLUS_DOWN_GAIN)).not.toBeNull();
    // the same 25px upward still needs the full push
    expect(moodAtPush(0, -25, DEAD, PLUS_DOWN_GAIN)).toBeNull();
  });

  it("aims downward at the same face a long push would", () => {
    expect(moodAtPush(0, 25, DEAD, PLUS_DOWN_GAIN)).toBe(moodAtPush(0, 80, DEAD));
  });

  it("leaves the card's ring (no gain) exactly as it was", () => {
    for (const [dx, dy] of [[40, 10], [-30, 45], [0, 60], [50, -50]]) {
      expect(moodAtPush(dx, dy, DEAD, 1)).toBe(moodAtPush(dx, dy, DEAD));
    }
  });
});
