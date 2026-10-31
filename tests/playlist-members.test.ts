import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { membersAfterSharing } from "../convex/socialRules";

/**
 * Turning off both Public and Collaborative used to take the invite link down
 * but leave everyone who had joined with the playlist (and their saves still
 * landing in it). Now they all leave; and the owner can take one person out.
 */
const social = readFileSync(resolve(__dirname, "..", "convex", "social.ts"), "utf8");
function fnBody(name: string): string {
  const start = social.indexOf(`export const ${name} = `);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = social.indexOf("\nexport ", start + 1);
  return social.slice(start, next < 0 ? undefined : next);
}

describe("members leave when sharing stops", () => {
  it("only a playlist that is neither public nor collaborative empties", () => {
    expect(membersAfterSharing({ visibility: "private", collaborative: false })).toBe("removeAll");
    expect(membersAfterSharing({})).toBe("removeAll");
    expect(membersAfterSharing({ visibility: "public", collaborative: false })).toBe("keep");
    expect(membersAfterSharing({ visibility: "private", collaborative: true })).toBe("keep");
  });

  it("setPlaylistSharing removes every member after the patch", () => {
    const body = fnBody("setPlaylistSharing");
    const patchAt = body.indexOf("await ctx.db.patch(playlistId, patch)");
    const sweep = body.indexOf('membersAfterSharing(next) === "removeAll"');
    expect(sweep).toBeGreaterThan(patchAt);
    expect(body.slice(sweep)).toMatch(/query\("playlistMembers"\)\.withIndex\("by_playlist"[\s\S]*?dropMember\(ctx, m\)/);
  });

  it("a dropped member's swipe-downs go back to Liked", () => {
    const drop = social.slice(social.indexOf("async function dropMember"), social.indexOf("export const removeMember"));
    expect(drop).toMatch(/ctx\.db\.delete\(m\._id\)/);
    expect(drop).toMatch(/saveTarget === `pl:\$\{m\.playlistId\}`\) await ctx\.db\.patch\(p\._id, \{ saveTarget: "liked" \}\)/);
  });
});

describe("the owner removes a member", () => {
  const body = fnBody("removeMember");
  it("only the owner, and only a member of this playlist", () => {
    expect(body).toMatch(/requireGatedUser\(ctx\)/);
    expect(body).toMatch(/pl\.userId !== user\.id\) throw new ConvexError/);
    expect(body).toMatch(/m\.playlistId !== playlistId\) return/);
    expect(body).toMatch(/dropMember\(ctx, m\)/);
  });
  it("member row ids go to the owner only, and no userId ever leaves", () => {
    const view = fnBody("playlist");
    expect(view).toMatch(/memberId: me === pl\.userId \? m\._id : null/);
    expect(view).not.toMatch(/userId: m\.userId/);
  });
  it("the owner's sharing panel has Remove, asked first", () => {
    const ui = readFileSync(resolve(__dirname, "..", "src", "components", "SocialScreens.tsx"), "utf8");
    const panel = ui.slice(ui.indexOf("export function PlaylistSharingPanel"), ui.indexOf("export function SharedPlaylistScreen"));
    expect(panel).toMatch(/removeMember\(\{ playlistId: pl\.id, memberId: m\.memberId! \}\)/);
    expect(panel).toMatch(/await confirm\(/);
  });
});
