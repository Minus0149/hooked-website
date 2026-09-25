import { describe, expect, it } from "vitest";
import { storedVolume } from "../src/lib/volume";

/** A fresh install must not start muted — the phone app once did. */
describe("storedVolume", () => {
  it("starts at full volume when nothing was saved", () => {
    expect(storedVolume(null)).toBe(1);
    expect(storedVolume(undefined)).toBe(1);
    expect(storedVolume("")).toBe(1);
  });
  it("keeps a saved level, including a deliberate zero", () => {
    expect(storedVolume("0.35")).toBe(0.35);
    expect(storedVolume("0")).toBe(0);
  });
  it("ignores anything out of range or unreadable", () => {
    expect(storedVolume("1.7")).toBe(1);
    expect(storedVolume("-1")).toBe(1);
    expect(storedVolume("loud")).toBe(1);
  });
});
