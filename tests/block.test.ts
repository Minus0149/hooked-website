import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETION } from "../convex/library";
import { BLOCK_LIST_MAX, blockProblem, blockedPeople } from "../convex/socialRules";

/**
 * Blocking someone (convex/social.ts block): follows go both ways, so does
 * the mutual playlist; neither sees the other's page, posts, playlists or
 * rooms; neither can follow or join the other again until it's lifted.
 */
const src = (file: string) => readFileSync(resolve(__dirname, "..", file), "utf8");
const social = src("convex/social.ts");
function fnBody(name: string): string {
  const start = social.indexOf(`export const ${name} = `);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = social.indexOf("\nexport ", start + 1);
  return social.slice(start, next < 0 ? undefined : next);
}

describe("block rules", () => {
  it("a block counts from both sides", () => {
    const rows = [
      { blockerId: "me", blockedId: "troll" },
      { blockerId: "ex", blockedId: "me" },
      { blockerId: "x", blockedId: "y" },
    ];
    expect([...blockedPeople(rows, "me")].sort()).toEqual(["ex", "troll"]);
    expect([...blockedPeople(rows, "y")]).toEqual(["x"]);
    expect(blockedPeople([], "me").size).toBe(0);
  });

  it("needs a real, different account", () => {
    expect(blockProblem("a", null)).toMatch(/No one/);
    expect(blockProblem("a", "a")).toMatch(/yourself/);
    expect(blockProblem("a", "b")).toBeNull();
    expect(BLOCK_LIST_MAX).toBeGreaterThanOrEqual(100);
  });
});

describe("blocking undoes every tie", () => {
  const separate = social.slice(social.indexOf("async function separate"), social.indexOf("export const block = "));

  it("block is signed in, rate limited, and separates the two", () => {
    const block = fnBody("block");
    expect(block).toMatch(/requireGatedUser\(ctx\)/);
    expect(block).toMatch(/enforceRateLimit\(ctx, `block:\$\{user\.id\}`/);
    expect(block).toMatch(/blockProblem\(user\.id/);
    expect(block).toMatch(/insert\("blocks"/);
    expect(block).toMatch(/await separate\(ctx, user\.id, them\)/);
  });

  it("runs both ways round: follows, playlist memberships and room seats", () => {
    expect(separate).toMatch(/for \(const \[x, y\] of \[\[a, b\], \[b, a\]\] as const\)/);
    expect(separate).toMatch(/withIndex\("by_pair", \(q\) => q\.eq\("followerId", x\)\.eq\("followeeId", y\)\)/);
    expect(separate).toMatch(/query\("playlistMembers"\)\.withIndex\("by_user", \(q\) => q\.eq\("userId", y\)\)/);
    expect(separate).toMatch(/pl\.userId !== x/);
    expect(separate).toMatch(/saveTarget: "liked"/);
    expect(separate).toMatch(/query\("roomMembers"\)\.withIndex\("by_user", \(q\) => q\.eq\("userId", y\)\)/);
    expect(separate).toMatch(/room\.hostId === x/);
  });

  it("unblock only removes my own block, and the list shows only mine", () => {
    expect(fnBody("unblock")).toMatch(/q\.eq\("blockerId", user\.id\)\.eq\("blockedId", target\.userId\)/);
    expect(fnBody("blocked")).toMatch(/withIndex\("by_blocker", \(q\) => q\.eq\("blockerId", me\)\)/);
    expect(fnBody("blocked")).not.toMatch(/by_blocked"/);
  });
});

describe("a block holds everywhere two people could meet", () => {
  it("no following either way", () => {
    expect(fnBody("follow")).toMatch(/blockedBetween\(ctx, user\.id, target!\.userId\)\) throw new ConvexError/);
  });

  it("the blocker sees a page with only Unblock; the blocked sees no page", () => {
    const profile = fnBody("profile");
    expect(profile).toMatch(/if \(await blockRow\(ctx, p\.userId, me\)\) return null;/);
    expect(profile).toMatch(/blockedByMe: true,[\s\S]*?playlists: \[\],\s*posts: \[\]/);
  });

  it("search, follower lists and the feed leave them out", () => {
    expect(fnBody("searchPeople")).toMatch(/!blocked\.has\(p\.userId\)/);
    expect(fnBody("connections")).toMatch(/blocked\.has\(x\.userId\)/);
    expect(fnBody("feed")).toMatch(/filter\(\(id\) => !blocked\.has\(id\)\)/);
  });

  it("no mutual playlist, no shared playlist, no invite, no room", () => {
    expect(fnBody("mutual")).toMatch(/blockedBetween\(ctx, me, other\.userId\)\) return null/);
    expect(fnBody("playlist")).toMatch(/blockedBetween\(ctx, me, pl\.userId\)\)\) return null/);
    expect(fnBody("invite")).toMatch(/blockedBetween\(ctx, me, pl\.userId\)\)\) return null/);
    expect(fnBody("joinPlaylist")).toMatch(/blockedBetween\(ctx, user\.id, pl\.userId\)\) throw/);
    expect(fnBody("joinRoom")).toMatch(/blockedBetween\(ctx, user\.id, room\.hostId\)\)\) throw/);
    expect(fnBody("room")).toMatch(/blockedBetween\(ctx, me, r\.hostId\)\)\) return null/);
  });

  it("a block is read from both directions", () => {
    const set = social.slice(social.indexOf("async function blockedSet"), social.indexOf("async function blockRow"));
    expect(set).toMatch(/by_blocker/);
    expect(set).toMatch(/by_blocked/);
    const between = social.slice(social.indexOf("async function blockedBetween"), social.indexOf("async function counts"));
    expect(between).toMatch(/blockRow\(ctx, a, b\)\) !== null \|\| \(await blockRow\(ctx, b, a\)\) !== null/);
  });
});

describe("blocks leave with the account, and the app can block", () => {
  it("account deletion removes blocks both ways", () => {
    expect(ACCOUNT_DELETION.deleted).toContain("blocks");
    const lib = src("convex/library.ts");
    expect(lib).toMatch(/query\("blocks"\)\.withIndex\("by_blocker", \(q\) => q\.eq\("blockerId", userId\)\)/);
    expect(lib).toMatch(/query\("blocks"\)\.withIndex\("by_blocked", \(q\) => q\.eq\("blockedId", userId\)\)/);
  });

  it("a profile has Block (asked first, the app's own dialog) and Settings lists the blocked", () => {
    const ui = src("src/components/SocialScreens.tsx");
    const button = ui.slice(ui.indexOf("function BlockButton"), ui.indexOf("export function BlockedPeople"));
    expect(button).toMatch(/await confirm\(\{/);
    expect(button).toMatch(/danger: true/);
    expect(ui).toMatch(/<BlockButton username=\{p\.username\} blocked=\{p\.blockedByMe\} \/>/);
    expect(src("src/components/SettingsScreen.tsx")).toMatch(/<BlockedPeople \/>/);
  });
});
