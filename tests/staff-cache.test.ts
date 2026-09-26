import { describe, expect, it } from "vitest";
import { readStaff, staffNow, writeStaff } from "../src/lib/staffCache";

/**
 * The admin button vanished after visiting the dashboard (Minus, 2026-09-26):
 * it read a query that is undefined for a moment on every mount. The last
 * known answer now holds it steady — for the same account only.
 */
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("staff cache", () => {
  it("keeps the admin button while the library query reloads", () => {
    const store = memory();
    writeStaff(store, "u1", { isAdmin: true, staff: true });
    expect(staffNow(undefined, readStaff(store, "u1"))).toEqual({ isAdmin: true, staff: true });
  });

  it("never hands one account's status to another", () => {
    const store = memory();
    writeStaff(store, "u1", { isAdmin: true, staff: true });
    expect(readStaff(store, "u2")).toEqual({ isAdmin: false, staff: false });
    expect(readStaff(store, null)).toEqual({ isAdmin: false, staff: false });
  });

  it("follows the server as soon as it answers, including a demotion", () => {
    expect(staffNow({ isAdmin: false, permissions: [] }, { isAdmin: true, staff: true })).toEqual({ isAdmin: false, staff: false });
    expect(staffNow({ isAdmin: false, permissions: ["stats.view"] }, { isAdmin: false, staff: false })).toEqual({ isAdmin: false, staff: true });
  });

  it("survives storage that throws", () => {
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(readStaff(broken, "u1")).toEqual({ isAdmin: false, staff: false });
    expect(() => writeStaff(broken, "u1", { isAdmin: true, staff: true })).not.toThrow();
  });
});
