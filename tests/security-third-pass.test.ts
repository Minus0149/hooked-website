import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ipRateKey } from "../convex/callerIp";
import { moderatorHid } from "../convex/creators";
import { removedRequestPatch } from "../convex/admin";
import { ACCOUNT_DELETION } from "../convex/library";

/**
 * The third security pass of 31 Oct 2026 (fresh-eyes review). Each block is
 * one finding: what could be done before, and the line that now stops it.
 */
const src = (file: string) => readFileSync(resolve(__dirname, "..", "convex", file), "utf8");
function fnBody(file: string, name: string): string {
  const s = src(file);
  const start = s.indexOf(`export const ${name} = `);
  expect(start, `${file} ${name}`).toBeGreaterThanOrEqual(0);
  const next = s.indexOf("\nexport ", start + 1);
  return s.slice(start, next < 0 ? undefined : next);
}

describe("an uploader can't republish a song a moderator took down", () => {
  it("staff and report hides are the moderator's; the uploader's own and curation's aren't", () => {
    expect(moderatorHid("admin")).toBe(true);
    expect(moderatorHid("report")).toBe(true);
    expect(moderatorHid("curation")).toBe(false);
    expect(moderatorHid(undefined)).toBe(false);
  });
  it("resolving a report as hide marks it, even on a song its owner had hidden", () => {
    const resolveFn = fnBody("contentReports.ts", "resolve");
    expect(resolveFn).toMatch(/if \(t && t\.hiddenBy !== "report"\)/);
    expect(resolveFn).toMatch(/hidden: true, hiddenBy: "report"/);
  });
  it("setTrackHidden refuses the un-hide unless a curator asks", () => {
    const set = fnBody("creators.ts", "setTrackHidden");
    expect(set).toMatch(/if \(!curator && moderatorHid\(track\.hiddenBy\)\) \{\s*throw new ConvexError/);
  });
});

describe("importPlaylist checks the run before any outside request", () => {
  const action = fnBody("imports.ts", "importPlaylist");
  it("signed in, the run's owner, its token, and only once", () => {
    const claim = action.indexOf("internal.imports.claimRun");
    expect(claim).toBeGreaterThan(0);
    expect(claim).toBeLessThan(action.indexOf("searchItunes("));
    expect(action).toMatch(/const identity = await ctx\.auth\.getUserIdentity\(\);\s*if \(!identity\) throw/);
    const run = fnBody("imports.ts", "claimRun");
    expect(run).toMatch(/internalMutation/);
    expect(run).toMatch(/!run \|\| run\.userId !== userId \|\| run\.claimedAt\) return false/);
    expect(run).toMatch(/patch\(importId, \{ claimedAt: Date\.now\(\) \}\)/);
  });
});

describe("a removed or suspended person can't come straight back", () => {
  it("what's left of their request is the address and a rejection", () => {
    const p = removedRequestPatch("removed by admin");
    expect(p.status).toBe("rejected");
    expect(p.decidedBy).toBe("removed by admin");
    for (const k of ["device", "notes", "genres", "listensOn", "userAgent", "hours", "lastSkipped", "androidVersion"] as const) {
      expect(p[k]).toBeUndefined();
    }
    expect(p.name).toBe("removed");
  });
  it("admin delete rejects the address and removes the sign-in and its sessions", () => {
    const del = fnBody("admin.ts", "deleteUserData");
    expect(del).toMatch(/patch\(request\._id, removedRequestPatch\("removed by admin"\)\)/);
    expect(del).toMatch(/adapter\.deleteMany[\s\S]*?model, where: \[\{ field: "userId", value: userId \}\]/);
    expect(del).toMatch(/adapter\.deleteOne[\s\S]*?model: "user"/);
  });
  it("a suspended account deleting itself leaves its address rejected", () => {
    const del = fnBody("library.ts", "deleteMyAccount");
    expect(del).toMatch(/if \(request && profile\.suspended\) await ctx\.db\.patch\(request\._id, removedRequestPatch\("suspended account deleted"\)\)/);
    expect(ACCOUNT_DELETION.kept.accessRequests).toMatch(/suspended/);
  });
});

describe("per-IP limits count an IPv6 subscriber once", () => {
  it("an IPv6 address counts by its /64", () => {
    expect(ipRateKey("2001:db8:85a3:0042:1000:8a2e:0370:7334")).toBe("2001:db8:85a3:42::/64");
    expect(ipRateKey("2001:db8:85a3:42:ffff::1")).toBe("2001:db8:85a3:42::/64");
    expect(ipRateKey("2001:DB8::1")).toBe("2001:db8:0:0::/64");
    expect(ipRateKey("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(ipRateKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });
  it("IPv4, mapped IPv4 and junk are left as they are", () => {
    expect(ipRateKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipRateKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipRateKey("1:2:3")).toBe("1:2:3");
    expect(ipRateKey("unknown")).toBe("unknown");
  });
  it("both ways in use it, each with its own shared ceiling", () => {
    expect(fnBody("access.ts", "submit")).toMatch(/access:ip:\$\{ipRateKey\(ip\)\}/);
    expect(fnBody("access.ts", "submit")).toMatch(/"access:global:app"/);
    expect(fnBody("access.ts", "record")).toMatch(/access:ip:\$\{ipRateKey\(ip\)\}/);
    expect(fnBody("access.ts", "record")).toMatch(/"access:global:landing"/);
  });
});

describe("nobody reads another listener's ad history", () => {
  it("nextAd takes the listener from the session, never the argument", () => {
    const next = fnBody("ads.ts", "nextAd");
    expect(next).toMatch(/handler: async \(ctx, \{ anonKey \}\)/);
    expect(next).toMatch(/const me = await authComponent\.safeGetAuthUser\(ctx\);\s*const userId = me \? String\(me\._id\) : undefined;/);
  });
});

describe("one listener can't pad a song's hook stats", () => {
  it("a hook is credited once per listener per day", () => {
    const swipe = fnBody("library.ts", "recordSwipe");
    expect(swipe).toMatch(/if \(hookId && \(await firstHookSwipeToday\(ctx, user\.id, hookId\)\)\)/);
    const lib = src("library.ts");
    expect(lib).toMatch(/enforceRateLimit\(ctx, `hookstat:\$\{userId\}:\$\{hookId\}`, 1, 86_400_000\)/);
  });
});

describe("minted device keys can't stop accounts' crash reports", () => {
  it("the shared ceiling holds back guests only, and counts only guests' rows", () => {
    const report = fnBody("errors.ts", "report");
    expect(report).toMatch(/if \(!user\) \{\s*const recent = await ctx\.db\.query\("errorReports"\)/);
    expect(report).toMatch(/r\.at >= hourAgo && !r\.userId/);
    expect(report).toMatch(/enforceRateLimit\(ctx, `err-report:\$\{identity\}`, 10/);
  });
});
