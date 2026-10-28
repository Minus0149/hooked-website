import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_FILTERS,
  CATALOGUE_PAGE_MAX,
  keepForFilter,
  keepJoined,
  mergeById,
} from "../convex/creatorRules";
import { TRACK_FILTERS } from "../src/components/creator/filter";

// The creator dashboard stopped loading for curators once the catalogue passed
// ~13,000 tracks: one query read every track, hook and counter and hit Convex's
// per-query read limit (28 Oct 2026). These keep it paged.
const source = readFileSync(new URL("../convex/creators.ts", import.meta.url), "utf8");
const block = (name: string) => {
  const start = source.indexOf(`export const ${name} = query(`);
  const end = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
};

describe("creator dashboard reads", () => {
  it("dashboard reads only the caller's own tracks, never the whole table", () => {
    const dash = block("dashboard");
    expect(dash).toContain('withIndex("by_owner"');
    expect(dash).not.toMatch(/query\("tracks"\)\s*\.collect\(\)/);
    expect(dash).not.toMatch(/query\("(hooks|hookStats|trackMoods)"\)\s*\.collect\(\)/);
  });

  it("the catalogue is paginated and searched through the search indexes", () => {
    const page = block("cataloguePage");
    expect(page).toContain('requirePermission(ctx, "catalog.curate")');
    expect(page).toContain(".paginate(");
    expect(page).toContain('withSearchIndex("search_title"');
    expect(page).toContain('withSearchIndex("search_artist"');
    expect(page).not.toMatch(/\.collect\(\)/);
    expect(CATALOGUE_PAGE_MAX).toBeLessThanOrEqual(100);
  });

  it("the server and the dashboard agree on the filters", () => {
    expect(TRACK_FILTERS.map((f) => f.id)).toEqual([...CATALOGUE_FILTERS]);
  });
});

describe("catalogue rules", () => {
  it("merges title and artist matches, title first, each track once", () => {
    const a = [{ _id: "1" }, { _id: "2" }];
    const b = [{ _id: "2" }, { _id: "3" }];
    expect(mergeById(a, b).map((t) => t._id)).toEqual(["1", "2", "3"]);
  });

  it("drafts are decided from the row; hooks and moods after the join", () => {
    expect(keepForFilter({ hidden: true }, "drafts")).toBe(true);
    expect(keepForFilter({}, "drafts")).toBe(false);
    expect(keepForFilter({}, "needs-hooks")).toBe(true);

    const noActive = { hooks: [{ active: false }], moods: [] };
    const hooked = { hooks: [{ active: true }], moods: ["calm"] };
    expect(keepJoined(noActive, "needs-hooks")).toBe(true);
    expect(keepJoined(hooked, "needs-hooks")).toBe(false);
    expect(keepJoined(hooked, "tagged")).toBe(true);
    expect(keepJoined(noActive, "tagged")).toBe(false);
    expect(keepJoined(noActive, "all")).toBe(true);
  });
});
