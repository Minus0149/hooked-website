import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queueLimit, workable } from "../convex/analyzer";
import { schedulesOn } from "../convex/crons";
import { RUNTIME_DEFAULTS } from "../convex/runtime";

/**
 * Nov 2026: the free plan's database I/O (1 GB/month) ran out and Convex
 * switched the deployments off. Almost all of it was reads of whole tables:
 * the analysers' work queues read every track per batch, the nightly snapshot
 * read every table and then failed, and the dev deployment ran all the same
 * jobs again. These tests keep those reads from coming back.
 */
const src = (f: string) => readFileSync(new URL(`../convex/${f}`, import.meta.url), "utf8");

describe("analyser work queues", () => {
  it("never read the whole tracks table", () => {
    expect(src("analyzer.ts")).not.toMatch(/query\("tracks"\)\s*\.collect\(\)/);
  });

  it("have an index for each queue", () => {
    const schema = src("schema.ts");
    for (const ix of ["by_analyzedAt", "by_energyCal", "by_soundVersion"]) {
      expect(schema).toContain(`.index("${ix}"`);
    }
    const analyzer = src("analyzer.ts");
    for (const ix of ["by_analyzedAt", "by_energyCal", "by_soundVersion"]) {
      expect(analyzer).toContain(`"${ix}"`);
    }
  });

  it("hand out between 1 and 500 tracks per call", () => {
    expect(queueLimit(0)).toBe(1);
    expect(queueLimit(-5)).toBe(1);
    expect(queueLimit(Number.NaN)).toBe(1);
    expect(queueLimit(40)).toBe(40);
    expect(queueLimit(9999)).toBe(500);
  });

  it("only hand out listed tracks that have a preview", () => {
    expect(workable({ hidden: undefined, previewUrl: "https://x/p.m4a" })).toBe(true);
    expect(workable({ hidden: false, previewUrl: "https://x/p.m4a" })).toBe(true);
    expect(workable({ hidden: true, previewUrl: "https://x/p.m4a" })).toBe(false);
    expect(workable({ hidden: undefined, previewUrl: "" })).toBe(false);
  });
});

describe("scheduled jobs", () => {
  it("run unless the deployment says HOOKED_CRONS=off", () => {
    expect(schedulesOn({})).toBe(true);
    expect(schedulesOn({ HOOKED_CRONS: "" })).toBe(true);
    expect(schedulesOn({ HOOKED_CRONS: "on" })).toBe(true);
    expect(schedulesOn({ HOOKED_CRONS: "off" })).toBe(false);
    expect(schedulesOn({ HOOKED_CRONS: " OFF " })).toBe(false);
  });

  it("do not include the whole-history analytics snapshot", () => {
    expect(src("crons.ts")).not.toMatch(/internal\.admin\.computeSnapshot/);
  });
});

describe("catalogue rebuild and curation", () => {
  it("rebuilds the catalogue from listed tracks only, through an index", () => {
    expect(src("schema.ts")).toContain('.index("by_hidden", ["hidden"])');
    const page = src("catalog.ts").split("export const snapshotPage")[1].split("export const")[0];
    expect(page).toContain('.withIndex("by_hidden", (q) => q.lt("hidden", true))');
    expect(page).not.toMatch(/query\("tracks"\)\s*\.paginate/);
  });

  it("rebuilds in the background at most once a day", () => {
    expect(RUNTIME_DEFAULTS.catalogRebuildHours).toBeGreaterThanOrEqual(24);
  });

  it("curates every 3 days, not daily", () => {
    const block = src("crons.ts").split('"curate the catalogue"')[1].split(");")[0];
    expect(block).toContain("{ hours: 72 }");
  });
});

describe("jobs Convex support named (19 Nov 2026)", () => {
  const crons = src("crons.ts");
  const every = (name: string) => crons.split(`"${name}"`)[1].split(");")[0];

  it("fold daily counters from new rows only, never whole tables", () => {
    const rollup = src("admin.ts").split("export const rollupStats")[1].split("export const")[0];
    for (const t of ["profiles", "accessRequests", "imports"]) {
      expect(rollup).not.toMatch(new RegExp(`query\("${t}"\)\s*\.collect\(\)`));
    }
    expect(rollup).toContain('withIndex("by_creation_time", (q) => q.gt("_creationTime", wm))');
  });

  it("run the rollup and the import sweep hourly, not every 10 minutes", () => {
    expect(every("rollup daily counters")).toContain("{ minutes: 60 }");
    expect(every("sweep stale import runs")).toContain("{ minutes: 60 }");
  });

  it("rank hooks and compute heat every 6 hours", () => {
    expect(every("rank hooks by save rate")).toContain("{ hours: 6 }");
    expect(every("compute catalogue heat for the adventure answer")).toContain("{ hours: 6 }");
  });

  it("rebuild recommendations once a day", () => {
    expect(every("rebuild the recommendation model")).toContain("{ hours: 24 }");
  });
});
