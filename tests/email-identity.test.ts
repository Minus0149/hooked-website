import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPOSABLE_DOMAINS } from "../convex/disposableDomains";
import { DISPOSABLE_MESSAGE, EXTRA_DISPOSABLE, emailDomain, emailKey, isDisposableEmail, sameEmail } from "../convex/emailIdentity";
import { REFERRED_INVITE_WAIT_DAYS, cameByInvite, referralDecision, referralLockedUntil } from "../convex/referralRules";

/**
 * One person, one place in the queue. Gmail dots and "+tags" used to make a
 * fresh access request, referral and invite each time, and a temporary inbox
 * cost nothing to repeat. See convex/emailIdentity.ts.
 */
const src = (file: string) => readFileSync(resolve(__dirname, "..", "convex", file), "utf8");
function fnBody(file: string, name: string): string {
  const s = src(file);
  const start = s.indexOf(`export const ${name} = `);
  expect(start, `${file} ${name}`).toBeGreaterThanOrEqual(0);
  const next = s.indexOf("\nexport ", start + 1);
  return s.slice(start, next < 0 ? undefined : next);
}

describe("emailKey folds the spellings of one inbox together", () => {
  it("lowercases and trims", () => {
    expect(emailKey("  Night.Owl@Example.COM ")).toBe("night.owl@example.com");
  });
  it("strips a +tag on every domain", () => {
    expect(emailKey("me+hooked@outlook.com")).toBe("me@outlook.com");
    expect(emailKey("me+a+b@proton.me")).toBe("me@proton.me");
  });
  it("drops dots in the local part on Gmail only, and treats googlemail as gmail", () => {
    expect(emailKey("J.Doe+1@gmail.com")).toBe("jdoe@gmail.com");
    expect(emailKey("j.d.o.e@googlemail.com")).toBe("jdoe@gmail.com");
    expect(emailKey("j.doe@yahoo.com")).toBe("j.doe@yahoo.com");
  });
  it("leaves what it can't parse alone", () => {
    expect(emailKey("not-an-email")).toBe("not-an-email");
    expect(emailDomain("a@b.co.")).toBe("b.co");
  });
  it("folds full-width and other compatibility letters (NFKC)", () => {
    const wide = (t: string) => [...t].map((c) => (/[a-z.@]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join("");
    expect(emailKey(wide("j.doe@gmail.com"))).toBe("jdoe@gmail.com");
    expect(isDisposableEmail(wide("x@mailinator.com"))).toBe(true);
  });
  it("sameEmail compares on the key", () => {
    expect(sameEmail("jdoe@gmail.com", "J.DOE+invite@googlemail.com")).toBe(true);
    expect(sameEmail("jdoe@gmail.com", "jdoe2@gmail.com")).toBe(false);
  });
});

describe("temporary inboxes are refused", () => {
  it("knows the usual services", () => {
    for (const d of ["mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "yopmail.com", "temp-mail.io"]) {
      expect(isDisposableEmail(`someone@${d}`), d).toBe(true);
    }
  });
  it("catches subdomains and odd casing", () => {
    expect(isDisposableEmail("x@abc.Mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@mail.yopmail.com.")).toBe(true);
  });
  it("lets permanent providers through", () => {
    for (const d of ["gmail.com", "googlemail.com", "outlook.com", "yahoo.com", "icloud.com", "proton.me", "hookedcue.com", "iitb.ac.in"]) {
      expect(isDisposableEmail(`someone@${d}`), d).toBe(false);
    }
    // a bare TLD is never matched on its own
    expect(isDisposableEmail("x@com")).toBe(false);
  });
  it("the committed list is the real one, not a stub", () => {
    expect(DISPOSABLE_DOMAINS.length).toBeGreaterThan(3000);
    expect(EXTRA_DISPOSABLE.every((d) => /^[a-z0-9.-]+\.[a-z]+$/.test(d))).toBe(true);
  });
  it("says so plainly", () => {
    expect(DISPOSABLE_MESSAGE).toMatch(/permanent email/);
  });
});

describe("the access queue dedupes on the key", () => {
  it("both ways in look a request up by emailKey, and new rows carry it", () => {
    const access = src("access.ts");
    const upsert = access.slice(access.indexOf("async function upsertRequest"), access.indexOf("export const submit"));
    expect(upsert).toMatch(/isDisposableEmail\(email\)\) throw new ConvexError\(DISPOSABLE_MESSAGE\)/);
    expect(upsert).toMatch(/findRequest\(ctx, email\)/);
    expect(upsert).toMatch(/emailKey: emailKey\(email\)/);
    const find = access.slice(access.indexOf("export async function findRequest"), access.indexOf("export async function approvalRow"));
    expect(find.indexOf("by_emailKey")).toBeGreaterThan(0);
    expect(find.indexOf("by_emailKey")).toBeLessThan(find.indexOf('"by_email"'));
  });
  it("the per-email limits count a person, not a spelling", () => {
    expect(fnBody("access.ts", "submit")).toMatch(/emailKey\(cleanText\(args\.email, MAX\.email\)\)/);
    expect(fnBody("access.ts", "record")).toMatch(/access:email:\$\{key\}/);
  });
  it("the sign-up gate and the profile gate find the same row the queue wrote", () => {
    expect(fnBody("access.ts", "approvalFor")).toMatch(/approvalRow\(ctx, email\)/);
    expect(src("auth.ts")).toMatch(/approvalRow\(\{ db: c\.db \}, email\)/);
    expect(src("library.ts")).toMatch(/await approvalRow\(ctx, email\)/);
  });
  it("sign-up refuses a temporary inbox even with an old approval", () => {
    const auth = src("auth.ts");
    const before = auth.slice(auth.indexOf("before: async (user"));
    expect(before.indexOf("isDisposableEmail")).toBeLessThan(before.indexOf("approvalStatus("));
  });
  it("both HTTP routes answer a temporary inbox with the message, not a generic failure", () => {
    const http = src("http.ts");
    expect(http.match(/message === DISPOSABLE_MESSAGE/g)?.length).toBe(2);
    expect(http).toMatch(/error: "disposable", message \}, \{ status: 422/);
  });
  it("the backfill for older rows exists and is internal", () => {
    const body = fnBody("access.ts", "backfillEmailKeys");
    expect(body).toMatch(/internalMutation/);
    expect(body).toMatch(/patch\(row\._id, \{ emailKey: key \}\)/);
    expect(src("schema.ts")).toMatch(/emailKey: v\.optional\(v\.string\(\)\)/);
  });
});

describe("invites: no inviting yourself, and none for a week when you came in on one", () => {
  const base = {
    cap: 3,
    inviter: { userId: "u1", email: "jdoe@gmail.com" },
    applicantEmail: "friend@gmail.com",
    existingStatus: null,
    used: 0,
  } as const;

  it("an inviter's own inbox under another spelling is still themself", () => {
    expect(referralDecision({ ...base, applicantEmail: "J.Doe+2@googlemail.com" })).toBe("ignore");
    expect(referralDecision(base)).toBe("approve");
  });

  it("someone approved on a friend's invite waits 7 days for their own", () => {
    const joined = Date.UTC(2026, 9, 1);
    const day = 86_400_000;
    expect(REFERRED_INVITE_WAIT_DAYS).toBe(7);
    expect(referralLockedUntil(joined, true, joined + 3 * day)).toBe(joined + 7 * day);
    expect(referralLockedUntil(joined, true, joined + 7 * day)).toBeNull();
    expect(referralLockedUntil(joined, false, joined)).toBeNull();
    const locked = referralLockedUntil(joined, true, joined + day);
    expect(referralDecision({ ...base, inviterLockedUntil: locked, now: joined + day })).toBe("ignore");
    expect(referralDecision({ ...base, inviterLockedUntil: locked, now: joined + 8 * day })).toBe("approve");
  });

  it("knows who came in on an invite, even after the inviter left", () => {
    expect(cameByInvite({ referredBy: "u9" })).toBe(true);
    expect(cameByInvite({ referredBy: undefined, decidedBy: "referral:ABC2345" })).toBe(true);
    expect(cameByInvite({ decidedBy: "admin@hookedcue.com" })).toBe(false);
    expect(cameByInvite(null)).toBe(false);
  });

  it("applyReferral and the invite card use the lock", () => {
    const access = src("access.ts");
    const apply = access.slice(access.indexOf("async function applyReferral"));
    expect(apply).toMatch(/referralLockedUntil\(inviterProfile\._creationTime, cameByInvite\(inviterRequest\), now\)/);
    expect(apply).toMatch(/inviterLockedUntil,/);
    expect(fnBody("referrals.ts", "mine")).toMatch(/lockedUntil,/);
  });
});
