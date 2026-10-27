import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT } from "../convex/authLimits";

const rules = AUTH_RATE_LIMIT.customRules as Record<string, { window: number; max: number }>;
const perHour = (r: { window: number; max: number }) => (r.max * 3600) / r.window;

describe("Better Auth rate limits", () => {
  it("are on, and stored where every Convex instance sees them", () => {
    expect(AUTH_RATE_LIMIT.enabled).toBe(true);
    expect(AUTH_RATE_LIMIT.storage).toBe("database");
  });

  it("hold password guessing to a crawl", () => {
    expect(rules["/sign-in/*"].max / rules["/sign-in/*"].window).toBeLessThanOrEqual(5 / 60);
    expect(perHour(rules["/change-password"])).toBeLessThanOrEqual(30);
    expect(perHour(rules["/reset-password"])).toBeLessThanOrEqual(60);
  });

  it("can't be used to bomb someone's inbox", () => {
    // Better Auth's own default is 3 a minute = 180 an hour per address
    for (const path of ["/request-password-reset", "/forget-password", "/send-verification-email"]) {
      expect(rules[path], path).toBeDefined();
      expect(perHour(rules[path]), path).toBeLessThanOrEqual(10);
    }
  });

  it("bound sign-ups per address", () => {
    expect(perHour(rules["/sign-up/*"])).toBeLessThanOrEqual(10);
  });

  it("are the ones convex/auth.ts actually uses", () => {
    const auth = readFileSync(resolve(__dirname, "..", "convex", "auth.ts"), "utf8");
    expect(auth).toMatch(/rateLimit: AUTH_RATE_LIMIT/);
  });
});
