import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Face } from "../src/components/faces";
import { MOOD_IDS } from "../src/data/mood";

const draw = (props: Parameters<typeof Face>[0]) => renderToStaticMarkup(<Face {...props} />);

describe("the six faces", () => {
  it("draws every mood, each its own picture", () => {
    const pictures = MOOD_IDS.map((mood) => draw({ mood, size: 48 }));
    for (const svg of pictures) expect(svg).toContain('viewBox="0 0 48 48"');
    expect(new Set(pictures).size).toBe(MOOD_IDS.length);
  });

  it("moves only when asked", () => {
    for (const mood of MOOD_IDS) {
      expect(draw({ mood }), `${mood} still`).not.toMatch(/<animate/);
      expect(draw({ mood, animated: true }), `${mood} moving`).toMatch(/<animate/);
    }
  });

  it("starts a row of faces out of step", () => {
    expect(draw({ mood: "party", animated: true, delay: 0.39 })).toContain('begin="0.39s"');
  });

  it("uses the colour behind it for its cut-outs", () => {
    expect(draw({ mood: "chill", animated: true })).toContain("var(--face-cut");
  });
});
