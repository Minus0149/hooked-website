import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A collaborator joined a playlist and was told to "pick it as your swipe-down
 * target" with nothing to press, and a playlist joined in this session wasn't
 * in the local library yet, so a save aimed at it fell back to Liked locally.
 */
describe("collaborative playlist: Add songs by swiping", () => {
  const screens = readFileSync("src/components/SocialScreens.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");

  it("the shared playlist screen offers the button to anyone who can add", () => {
    expect(screens).toMatch(/onSaveHere\?: \(pl:/);
    expect(screens).toMatch(/pl\.canAdd && !pl\.isOwner[\s\S]{0,200}onSaveHere &&/);
    expect(screens).toContain('tx("Add songs by swiping")');
  });

  it("App teaches the store the playlist before aiming the deck at it", () => {
    expect(app).toContain("onSaveHere={saveIntoShared}");
    const body = app.slice(app.indexOf("const saveIntoShared"), app.indexOf("const startRoom"));
    expect(body.indexOf("createPlaylist(")).toBeGreaterThan(-1);
    expect(body.indexOf("createPlaylist(")).toBeLessThan(body.indexOf("handleDiscoverInto("));
    expect(body).toMatch(/playlists\.some\(\(p\) => p\.id === pl\.id\)/);
  });
});
