import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTED_LISTEN_MS, countsForCampaign, shownLongEnough } from "../convex/promotionRules";

const source = (file: string) => readFileSync(resolve(__dirname, "..", "convex", file), "utf8");

function handlerOf(file: string, name: string): string {
  const src = source(file);
  const start = src.indexOf(`export const ${name} = `);
  if (start < 0) throw new Error(`${file}: no export ${name}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

// An artist pays per listener. A fresh anonKey per call used to count as a
// fresh listener, so a script could finish anyone's campaign in minutes and
// leave nothing to refund.
describe("paid promotion counts real listeners only", () => {
  it("never counts an anonymous install key", () => {
    expect(countsForCampaign("a:0123456789abcdef", "artist", true)).toBe(false);
    expect(countsForCampaign("a:another-fresh-key", "artist", true)).toBe(false);
  });

  it("counts a signed-in listener with an active account", () => {
    expect(countsForCampaign("u:listener", "artist", true)).toBe(true);
  });

  it("doesn't count an account that is suspended or has no profile", () => {
    expect(countsForCampaign("u:listener", "artist", false)).toBe(false);
  });

  it("doesn't count the artist on their own campaign", () => {
    expect(countsForCampaign("u:artist", "artist", true)).toBe(false);
  });

  it("measures the 3 seconds on the server, from when the card was shown", () => {
    const shown = 1_000_000;
    expect(shownLongEnough(shown, shown)).toBe(false);
    expect(shownLongEnough(shown, shown + COUNTED_LISTEN_MS - 1)).toBe(false);
    expect(shownLongEnough(shown, shown + COUNTED_LISTEN_MS)).toBe(true);
    expect(shownLongEnough(Number.NaN, shown)).toBe(false);
  });

  it("recordPromoted applies both rules before touching delivery or stats", () => {
    const body = handlerOf("promotions.ts", "recordPromoted");
    const gate = body.indexOf("countsForCampaign(");
    expect(gate).toBeGreaterThan(0);
    expect(body).toMatch(/shownLongEnough\(view\.at, Date\.now\(\)\)/);
    // the gate comes before the first write to the campaign
    expect(gate).toBeLessThan(body.indexOf("ctx.db.patch(c._id"));
  });
});
