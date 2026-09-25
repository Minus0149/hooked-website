import { describe, expect, it } from "vitest";
import { TOUR_COPY, tasteStepButton } from "../src/lib/tourCopy";

/**
 * Both tours render from this module. The phone tour once had no button past
 * the taste questions at all; the label rule is the piece both must agree on.
 */
describe("tasteStepButton", () => {
  const none = { languages: [], genres: [] };
  it("offers to skip a multi-pick question left empty", () => {
    expect(tasteStepButton(1, none)).toBe("Skip this");
    expect(tasteStepButton(2, none)).toBe("Skip this");
  });
  it("moves on once something is picked", () => {
    expect(tasteStepButton(1, { languages: ["hi"], genres: [] })).toBe("Next");
    expect(tasteStepButton(2, { languages: [], genres: ["pop"] })).toBe("Next");
  });
  it("always says Next on the single-choice adventure question", () => {
    expect(tasteStepButton(3, none)).toBe("Next");
  });
});

describe("TOUR_COPY", () => {
  it("keeps every headline in two parts, the accent last", () => {
    for (const step of [TOUR_COPY.welcome, TOUR_COPY.languages, TOUR_COPY.genres, TOUR_COPY.adventure]) {
      expect(step.headline.lead.length).toBeGreaterThan(0);
      expect(step.headline.accent.length).toBeGreaterThan(0);
    }
  });
});
