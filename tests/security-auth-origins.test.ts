import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { authTrustedOrigins } from "../convex/authLimits";
// Better Auth's own matcher, so the test checks what the server really does
// @ts-expect-error untyped internal module
import { matchesOriginPattern } from "../node_modules/better-auth/dist/auth/trusted-origins.mjs";

const SITE = "https://app.hookedcue.com";
const trusted = (url: string) =>
  authTrustedOrigins(SITE).some((pattern) =>
    (matchesOriginPattern as (u: string, p: string, s?: { allowRelativePaths: boolean }) => boolean)(url, pattern, {
      allowRelativePaths: true,
    }),
  );

// "exp://" was trusted as a prefix: a password reset requested for someone
// else's email with redirectTo=exp://attacker/... bounced the real reset email's
// reader there with the reset token, which Expo Go then fetched from the
// attacker's server.
describe("auth redirects stay on HookedCue", () => {
  it("accepts the web app and the phone app's own scheme", () => {
    expect(trusted(`${SITE}/reset-password`)).toBe(true);
    expect(trusted("/profile")).toBe(true);
    expect(trusted("hooked://track/123")).toBe(true);
  });

  it("refuses an exp:// URL on any host", () => {
    expect(trusted("exp://attacker.example:443/--/reset")).toBe(false);
    expect(trusted("exp://192.168.1.5:8081")).toBe(false);
    expect(authTrustedOrigins(SITE).some((o) => o.startsWith("exp"))).toBe(false);
  });

  it("refuses other sites and look-alikes", () => {
    expect(trusted("https://evil.example/reset")).toBe(false);
    expect(trusted("https://app.hookedcue.com.evil.example")).toBe(false);
    expect(trusted("//evil.example")).toBe(false);
    expect(trusted("javascript:alert(1)")).toBe(false);
  });

  it("auth.ts takes its trusted origins from this list", () => {
    const src = readFileSync(resolve(__dirname, "..", "convex", "auth.ts"), "utf8");
    expect(src).toMatch(/trustedOrigins: authTrustedOrigins\(siteUrl\)/);
    expect(src).not.toMatch(/"exp:\/\/"\s*[\],]/);
  });
});
