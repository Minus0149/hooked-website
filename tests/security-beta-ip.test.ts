import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestIp } from "../convex/callerIp";

const LANDING_SERVER = "203.0.113.10";

// /beta is called by the landing's server, so the request IP was the same for
// every visitor: all landing signups shared one 30-an-hour per-IP allowance.
describe("landing signups are limited per visitor, not per landing server", () => {
  it("uses the visitor IP the landing forwards", () => {
    expect(ingestIp("198.51.100.7", LANDING_SERVER)).toBe("198.51.100.7");
    expect(ingestIp(" 2001:db8::1 ", LANDING_SERVER)).toBe("2001:db8::1");
  });

  it("falls back to the request's IP when nothing usable is forwarded", () => {
    expect(ingestIp(undefined, LANDING_SERVER)).toBe(LANDING_SERVER);
    expect(ingestIp("", LANDING_SERVER)).toBe(LANDING_SERVER);
    expect(ingestIp(42, LANDING_SERVER)).toBe(LANDING_SERVER);
    expect(ingestIp("unknown", LANDING_SERVER)).toBe(LANDING_SERVER);
    expect(ingestIp("1.2.3.4; drop", LANDING_SERVER)).toBe(LANDING_SERVER);
    expect(ingestIp("1".repeat(65), LANDING_SERVER)).toBe(LANDING_SERVER);
  });

  it("the /beta route passes the forwarded IP to access.record", () => {
    const src = readFileSync(resolve(__dirname, "..", "convex", "http.ts"), "utf8");
    const route = src.slice(src.indexOf('path: "/beta"'), src.indexOf('path: "/analyzer/pending"'));
    expect(route).toMatch(/ip: ingestIp\(body\.ip, clientIp\(request\)\)/);
    // the secret check still comes first
    expect(route.indexOf("safeEqual(provided, secret)")).toBeLessThan(route.indexOf("ingestIp("));
  });
});
