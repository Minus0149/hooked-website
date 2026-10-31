import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HAS_MOBILE } from "./mobile-sibling";

/**
 * Block (ac82479) and the owner's "remove member" (981ba72) on the phone,
 * ported for v8. The phone has no pages for other people, so Block sits on a
 * shared playlist's people list; Unblock is in Data & privacy, as on the web.
 */
const read = (p: string) => readFileSync(p, "utf8");
const mobile = (p: string) => (HAS_MOBILE ? read(`../mobile/${p}`) : "");
const server = read("convex/social.ts");

/** `export const name = mutation({ args: { … } })` → the arg names. */
function serverArgs(name: string): string[] {
  const m = new RegExp(`export const ${name} = (?:query|mutation)\\(\\{\\s*args: \\{([^}]*)\\}`).exec(server);
  if (!m) throw new Error(`convex/social.ts has no ${name}`);
  return [...m[1].matchAll(/(\w+):/g)].map((x) => x[1]).sort();
}

describe.skipIf(!HAS_MOBILE)("the phone's block and remove-member calls", () => {
  const people = mobile("src/components/People.tsx");

  it("calls the web's Convex functions with the server's own argument names", () => {
    expect(people).toMatch(/useMutation\(anyApi\.social\.block\)/);
    expect(people).toMatch(/useMutation\(anyApi\.social\.unblock\)/);
    expect(people).toMatch(/useQuery\(anyApi\.social\.blocked\)/);
    expect(people).toMatch(/useMutation\(anyApi\.social\.removeMember\)/);
    expect(people).toMatch(/useQuery\(anyApi\.social\.playlist, signedIn \? \{ playlistId \} : "skip"\)/);

    expect(serverArgs("block")).toEqual(["username"]);
    expect(serverArgs("unblock")).toEqual(["username"]);
    expect(serverArgs("removeMember")).toEqual(["memberId", "playlistId"]);
    expect(people).toMatch(/await block\(\{ username \}\)/);
    expect(people).toMatch(/await unblock\(\{ username: x\.username \}\)/);
    expect(people).toMatch(/await removeMember\(\{ playlistId: pl\.id, memberId: m\.memberId \}\)/);
  });

  it("asks first, in the app's own dialog, with the web's words", () => {
    expect(people).toMatch(/useDialogs\(\)/);
    expect(people).not.toMatch(/\bAlert\./);
    expect(people).toContain("Block @{name}?");
    expect(people).toContain("Remove {name}?");
    expect(people).toContain("They lose this playlist. Songs they added stay until you remove them.");
    expect(people).toContain("People in it. Turning off Public and Collaborative takes everyone out.");
  });

  it("only the owner sees Remove, and only for rows the server gave an id", () => {
    expect(people).toMatch(/pl\.isOwner && m\.memberId && \(/);
  });

  it("puts the blocked list in Data & privacy and the people list on a playlist", () => {
    expect(mobile("src/components/settings/DataPage.tsx")).toMatch(/\{signedIn && <BlockedPeople \/>\}/);
    expect(mobile("src/components/LibraryScreen.tsx")).toMatch(/<PlaylistPeople playlistId=\{playlistId\}/);
  });
});

describe.skipIf(!HAS_MOBILE)("a shared playlist the server took away leaves the phone", () => {
  it("drops joined playlists the library stopped listing, never the listener's own", async () => {
    const url = new URL("../../mobile/src/lib/sharedPlaylists.ts", import.meta.url).href;
    const { droppedShared } = (await import(/* @vite-ignore */ url)) as typeof import("../../mobile/src/lib/sharedPlaylists");
    // joined a and b; the owner of b removed them (or went private)
    expect(droppedShared(new Set(["a", "b"]), new Set(["mine", "a"]))).toEqual(["b"]);
    // nothing joined: nothing to drop, however the list changes
    expect(droppedShared(new Set(), new Set())).toEqual([]);
  });

  it("App.tsx runs it on every library change and removes only the local copy", () => {
    const app = mobile("App.tsx");
    expect(app).toMatch(/library\.playlists\.filter\(\(p\) => p\.sharedBy\)/);
    expect(app).toMatch(/for \(const id of droppedShared\(before, listed\)\) deletePlaylist\(id\);/);
  });
});
