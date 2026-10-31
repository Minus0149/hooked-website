import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nameFor } from "../convex/access";
import { ACCOUNT_DELETION } from "../convex/library";
import { publicName } from "../convex/socialRules";

/**
 * The second security pass of 31 Oct 2026. Each block is one finding: what
 * could be done before, and the line that now stops it.
 */
const src = (file: string) => readFileSync(resolve(__dirname, "..", "convex", file), "utf8");

/** The body of one exported Convex function, up to the next export. */
function fnBody(file: string, name: string): string {
  const s = src(file);
  const start = s.indexOf(`export const ${name} = `);
  expect(start, `${file} ${name}`).toBeGreaterThanOrEqual(0);
  const next = s.indexOf("\nexport ", start + 1);
  return s.slice(start, next < 0 ? undefined : next);
}

describe("mood votes only tally songs that exist", () => {
  // moods.crowd reads the whole trackMoods table for every listener. A vote on
  // a made-up id (any length, 240 a minute per account) used to add a row, so
  // one account could grow the table until crowd() hit Convex's read limits
  // and failed for everyone.
  const vote = fnBody("moods.ts", "vote");

  it("bounds the id the client sends", () => {
    expect(vote).toMatch(/cleanText\(rawTrackId, 120\)/);
  });

  it("looks the song up before any write, and writes nothing for an unknown one", () => {
    const lookup = vote.indexOf('.query("tracks")');
    const bail = vote.indexOf("if (!known) return;");
    expect(lookup).toBeGreaterThan(0);
    expect(bail).toBeGreaterThan(lookup);
    for (const write of ['insert("moodVotes"', 'insert("trackMoods"', "ctx.db.patch("]) {
      expect(vote.indexOf(write), write).toBeGreaterThan(bail);
    }
  });

  it("never uses the raw client id for a read or a write", () => {
    expect(vote.match(/rawTrackId/g)?.length).toBe(2); // the destructure and the cleanText
  });
});

describe("nobody sees half of someone else's email address", () => {
  it("a nameless signup's stored name is its email's local part, and reads as Someone", () => {
    const email = "night.owl1987@example.com";
    expect(nameFor("", email)).toBe("night.owl1987");
    expect(publicName({ name: nameFor("", email), email })).toBe("Someone");
  });

  it("a shared playlist names its owner the way social.ts does", () => {
    const getLibrary = fnBody("library.ts", "getLibrary");
    expect(getLibrary).toMatch(/ownerNames\.set\(p\.userId, publicName\(o\)\)/);
    expect(getLibrary).not.toMatch(/o\?\.name/);
  });

  it("an inviter's list names friends without their address", () => {
    const mine = fnBody("referrals.ts", "mine");
    expect(mine).toMatch(/name: publicName\(\{ name: r\.name, email: r\.email \}\)/);
    expect(mine).not.toMatch(/^\s*name: r\.name,/m);
  });
});

describe("a password reset signs out every other session", () => {
  it("is switched on in Better Auth", () => {
    expect(src("auth.ts")).toMatch(/revokeSessionsOnPasswordReset: true/);
  });
});

describe("a Razorpay webhook that fails is retried, not skipped", () => {
  const promotions = src("promotions.ts");
  const hook = promotions.slice(promotions.indexOf("export const razorpayWebhook"));

  it("claims the event before handling it", () => {
    expect(hook.indexOf("claimEvent")).toBeGreaterThan(0);
    expect(hook.indexOf("claimEvent")).toBeLessThan(hook.indexOf("markPaid"));
  });

  it("releases the claim and answers 500 when handling throws", () => {
    const catchAt = hook.indexOf("} catch (error) {");
    expect(catchAt).toBeGreaterThan(hook.indexOf("markPaid"));
    const handler = hook.slice(catchAt, hook.lastIndexOf('return new Response("ok"'));
    expect(handler).toMatch(/internal\.promotions\.releaseEvent, \{ eventId \}/);
    expect(handler).toMatch(/status: 500/);
  });

  it("releaseEvent removes the claimed row", () => {
    expect(fnBody("promotions.ts", "releaseEvent")).toMatch(/ctx\.db\.delete\(row\._id\)/);
  });
});

describe("deleting an account detaches it from its song reports", () => {
  it("is a decision in ACCOUNT_DELETION", () => {
    expect(ACCOUNT_DELETION.kept.contentReports).toBeDefined();
  });

  it("replaces the reporter on every report the person filed", () => {
    const del = fnBody("library.ts", "deleteMyAccount");
    expect(del).toMatch(/\.query\("contentReports"\)\s*\.withIndex\("by_reporter_track", \(q\) => q\.eq\("reporter", `user:\$\{userId\}`\)\)/);
    expect(del).toMatch(/patch\(r\._id, \{ reporter: "deleted" \}\)/);
  });
});
