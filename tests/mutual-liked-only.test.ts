import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MUTUAL_SOURCE_KIND, mutualMix, mutualSource } from "../convex/socialRules";

/**
 * Following someone back used to open their whole library: the mutual playlist
 * read every librarySongs row, so private playlists and discoveries showed to
 * the other person. It now draws from each side's Liked songs only.
 */
const social = readFileSync(resolve(__dirname, "..", "convex", "social.ts"), "utf8");

describe("the mutual playlist shows Liked songs only", () => {
  const rows = [
    { trackId: "a", kind: "liked" },
    { trackId: "secret", kind: "playlist" },
    { trackId: "found", kind: "discoveries" },
    { trackId: "b", kind: "liked" },
  ];

  it("keeps the Liked rows and drops playlists and discoveries", () => {
    expect(MUTUAL_SOURCE_KIND).toBe("liked");
    expect(mutualSource(rows).map((r) => r.trackId)).toEqual(["a", "b"]);
  });

  it("a song only in someone's private playlist never reaches the mix", () => {
    const mine = mutualSource([{ trackId: "x", kind: "liked" }]);
    const theirs = mutualSource(rows);
    const ids = mutualMix(mine, theirs).items.map((i) => i.song.trackId);
    expect(ids).not.toContain("secret");
    expect(ids).not.toContain("found");
    expect(ids).toEqual(expect.arrayContaining(["a", "b", "x"]));
  });

  it("the query reads the liked kind through the index, never the whole library", () => {
    const fn = social.slice(social.indexOf("async function likedSongs"), social.indexOf("const song = "));
    expect(fn).toMatch(/q\.eq\("userId", userId\)\.eq\("kind", MUTUAL_SOURCE_KIND\)/);
    expect(fn).toMatch(/mutualSource\(rows\)/);
    expect(social).not.toMatch(/savedSongs\(/);
    const mutual = social.slice(social.indexOf("export const mutual = "), social.indexOf("// Shared and collaborative playlists"));
    expect(mutual).toMatch(/likedSongs\(ctx, me\), likedSongs\(ctx, other\.userId\)/);
  });
});
