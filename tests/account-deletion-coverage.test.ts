import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETION } from "../convex/library";

/**
 * "Delete my account" has to remove everything tied to a person — Google Play
 * checks it, and hookedcue.com/data-deletion promises it. It used to leave the
 * sign-in itself, mood votes, imports, ad events, crash reports and creator
 * uploads behind. This reads the schema and fails when a table that stores a
 * person's id or email isn't covered, so a new table can't quietly fall
 * outside deletion again.
 */
describe("account deletion coverage", () => {
  const schema = readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8");
  // table name -> its body, up to the next top-level table
  const tables = [...schema.matchAll(/^ {2}(\w+): defineTable\(\{([\s\S]*?)^ {2}\}\)/gm)].map((m) => ({
    name: m[1],
    body: m[2],
  }));

  it("finds the tables", () => {
    expect(tables.length).toBeGreaterThan(15);
  });

  it("covers every table that stores a person's id or email", () => {
    const personal = tables
      .filter((t) => /^\s*(userId|userEmail|email|ownerUserId):/m.test(t.body))
      .map((t) => t.name);
    const decided = new Set<string>([
      ...ACCOUNT_DELETION.deleted,
      ...Object.keys(ACCOUNT_DELETION.kept),
      "tracks", // creator-owned tracks are deleted via ownerUserId
      "rateLimits", // keyed by id or email but expire within hours; see /data-deletion
    ]);
    const missing = personal.filter((t) => !decided.has(t));
    expect(missing).toEqual([]);
  });
});
