import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// security.ts imports the auth component; the rule under test needs none of it
vi.mock("../convex/auth", () => ({ authComponent: {} }));

const { hasPermission } = await import("../convex/security");

const staff = (extra: Record<string, unknown> = {}) => ({
  _id: "p1" as never,
  userId: "u1",
  email: "mod@example.com",
  isAdmin: false,
  permissions: ["users.manage", "users.view"],
  ...extra,
});

// A suspended moderator kept users.manage, so they could keep deciding the
// queue and call admin.setSuspended on their own profile to lift it.
describe("suspension takes the dashboard away too", () => {
  it("a granted permission works while the account is active", () => {
    expect(hasPermission(staff(), "users.manage")).toBe(true);
    expect(hasPermission(staff({ suspended: false }), "users.view")).toBe(true);
  });

  it("a suspended account holds no permission at all", () => {
    expect(hasPermission(staff({ suspended: true }), "users.manage")).toBe(false);
    expect(hasPermission(staff({ suspended: true }), "users.view")).toBe(false);
    expect(hasPermission(staff({ suspended: true, isAdmin: true }), "users.manage")).toBe(false);
  });

  it("no profile, no permission", () => {
    expect(hasPermission(null, "stats.view")).toBe(false);
  });

  it("the dashboard queries' own check refuses a suspended viewer as well", () => {
    const src = readFileSync(resolve(__dirname, "..", "convex", "admin.ts"), "utf8");
    const fn = src.slice(src.indexOf("function hasPerm("), src.indexOf("/** What the current viewer"));
    expect(fn).toMatch(/profile\.suspended\) return false/);
  });
});
