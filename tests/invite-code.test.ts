import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it } from "vitest";
import * as access from "../convex/access";
import { createAuth } from "../convex/auth";
import { inviteEmail, inviteReminderEmail } from "../convex/emailTemplate";
import {
  cleanInviteCode,
  formatInviteCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_CODE_MESSAGES,
  INVITE_CODES_KEPT,
  inviteCodeHash,
  inviteCodeMatches,
  newInviteCode,
  withNewHash,
} from "../convex/inviteCodes";
import { cleanInviteCode as clientClean, friendlyAuthError, inviteCodeProblem, isNotApproved } from "../src/lib/authForms";
import { routeFor } from "../src/lib/routes";
import { HAS_MOBILE } from "./mobile-sibling";

/**
 * The invite's one-time code (31 Oct 2026, third security pass). Signing up
 * with an approved address used to be enough, so whoever typed an invited
 * email first kept their own password, and the owner's click on the
 * confirmation link made that account usable. Creating the account now needs
 * a code only the inbox was sent.
 *
 * The Convex functions run here against a small in-memory database: enough of
 * ctx.db, the scheduler and the Better Auth component for these flows.
 */

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

function fakeConvex() {
  const tables = new Map<string, Row[]>();
  const sent: { to: string; subject: string; html: string }[] = [];
  const authUsers: { _id: string; email: string; emailVerified: boolean }[] = [];
  const removedUsers: string[] = [];
  let n = 0;
  const table = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!;
  const find = (id: string) => [...tables.values()].flat().find((r) => r._id === id) ?? null;

  const queryOf = (name: string) => {
    let conds: [string, unknown][] = [];
    const rows = () => table(name).filter((r) => conds.every(([f, v]) => r[f] === v));
    const q = {
      withIndex(_index: string, build?: (b: unknown) => unknown) {
        const b = {
          eq(field: string, value: unknown) {
            conds.push([field, value]);
            return b;
          },
        };
        build?.(b);
        return q;
      },
      order: () => q,
      first: async () => rows()[0] ?? null,
      unique: async () => rows()[0] ?? null,
      collect: async () => rows(),
      take: async (k: number) => rows().slice(0, k),
    };
    conds = [];
    return q;
  };

  const db = {
    query: (name: string) => queryOf(name),
    get: async (id: string) => find(id),
    insert: async (name: string, doc: Record<string, unknown>) => {
      const _id = `${name}:${++n}`;
      table(name).push({ ...doc, _id, _creationTime: Date.now() });
      return _id;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const row = find(id);
      if (row) Object.assign(row, patch);
    },
    delete: async (id: string) => {
      for (const rows of tables.values()) {
        const i = rows.findIndex((r) => r._id === id);
        if (i >= 0) rows.splice(i, 1);
      }
    },
  };

  const ctx: Record<string, unknown> = {
    db,
    scheduler: {
      runAfter: async (_ms: number, fn: unknown, args: { to: string; subject: string; html: string }) => {
        if (getFunctionName(fn as never) === "email:send") sent.push(args);
      },
    },
  };
  // a component's functions are addressed by path, not by name
  const nameOf = (fn: unknown) => {
    try {
      return getFunctionName(fn as never);
    } catch {
      return String((fn as Record<symbol, unknown>)[Symbol.for("toReferencePath")] ?? "");
    }
  };
  // the Better Auth component's adapter, as access.ts and auth.ts call it
  const component = async (fn: unknown, args: Record<string, unknown>) => {
    const name = nameOf(fn);
    if (name.endsWith("adapter/findOne")) {
      const email = (args.where as { value: string }[])[0].value;
      return authUsers.find((u) => u.email === email) ?? null;
    }
    if (name.endsWith("adapter/deleteOne")) {
      const id = ((args.input as { where: { value: string }[] }).where)[0].value;
      removedUsers.push(id);
      authUsers.splice(authUsers.findIndex((u) => u._id === id), 1);
      return null;
    }
    if (name.endsWith("adapter/deleteMany")) return null;
    // the sign-up hook reaches our own functions through the HTTP action's runQuery/runMutation
    const local = name.split(":")[1] as keyof typeof access;
    const registered = access[local] as unknown as { _handler?: (c: unknown, a: unknown) => unknown };
    if (!registered?._handler) throw new Error(`no fake for ${name}`);
    return registered._handler(ctx, args);
  };
  ctx.runQuery = component;
  ctx.runMutation = component;

  const run = <A,>(fn: unknown, args: A) =>
    (fn as { _handler: (c: unknown, a: A) => Promise<unknown> })._handler(ctx, args) as Promise<never>;
  const request = (email: string) => table("accessRequests").find((r) => r.email === email) as Row | undefined;
  return { ctx, db, table, sent, authUsers, removedUsers, run, request };
}

/** The code an invite email printed (the link carries the same one). */
function codeIn(html: string): string {
  const m = /code=([A-Z0-9]+)/.exec(html);
  expect(m, "invite link carries a code").not.toBeNull();
  return m![1];
}

let f: ReturnType<typeof fakeConvex>;
beforeEach(() => {
  f = fakeConvex();
});

describe("the code itself", () => {
  it("is 8 characters from an alphabet with no 0/O or 1/I, and never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = newInviteCode();
      expect(c).toHaveLength(INVITE_CODE_LENGTH);
      for (const ch of c) expect(INVITE_CODE_ALPHABET).toContain(ch);
      seen.add(c);
    }
    expect(seen.size).toBe(500);
    for (const ch of "0O1I") expect(INVITE_CODE_ALPHABET).not.toContain(ch);
  });

  it("is printed in two groups, and read back however it was typed", () => {
    expect(formatInviteCode("K7QM4XRP")).toBe("K7QM-4XRP");
    expect(cleanInviteCode(" k7qm-4xrp ")).toBe("K7QM4XRP");
    expect(cleanInviteCode(undefined)).toBe("");
    // the forms clean it the same way
    expect(clientClean(" k7qm-4xrp ")).toBe(cleanInviteCode(" k7qm-4xrp "));
  });

  it("is stored as a salted, peppered hash, and only the right code matches", async () => {
    const h = await inviteCodeHash("req1", "K7QM4XRP", "pep");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("K7QM");
    expect(await inviteCodeHash("req2", "K7QM4XRP", "pep")).not.toBe(h);
    expect(await inviteCodeHash("req1", "K7QM4XRP", "other")).not.toBe(h);
    expect(await inviteCodeMatches("req1", "k7qm-4xrp", [h], "pep")).toBe(true);
    expect(await inviteCodeMatches("req1", "K7QM4XRQ", [h], "pep")).toBe(false);
    expect(await inviteCodeMatches("req1", "", [h], "pep")).toBe(false);
    expect(await inviteCodeMatches("req1", "K7QM4XRP", [], "pep")).toBe(false);
  });

  it("keeps the newest few outstanding codes", () => {
    let hashes: string[] | undefined;
    for (const h of ["a", "b", "c", "d"]) hashes = withNewHash(hashes, h);
    expect(hashes).toEqual(["b", "c", "d"].slice(-INVITE_CODES_KEPT));
  });

  it("refusals read plainly and aren't rewritten by the forms", () => {
    expect(INVITE_CODE_MESSAGES.wrong).toBe("This invite code doesn't match. Use the code from your invite email.");
    for (const m of Object.values(INVITE_CODE_MESSAGES)) {
      expect(friendlyAuthError(m)).toBe(m);
      expect(isNotApproved(m)).toBe(false);
    }
    // an old phone build has no code box: the message says where else to go
    expect(INVITE_CODE_MESSAGES.missing).toMatch(/link in that email/);
    expect(INVITE_CODE_MESSAGES.missing).toMatch(/update the HookedCue app/);
  });
});

describe("approving someone mails a code and stores only its hash", () => {
  it("operator approve", async () => {
    await f.run(access.approve, { emails: ["ada@gmail.com"] });
    const row = f.request("ada@gmail.com")!;
    expect(row.invited).toBe(true);
    const hashes = row.inviteCodeHashes as string[];
    expect(hashes).toHaveLength(1);
    expect(f.sent).toHaveLength(1);
    const code = codeIn(f.sent[0].html);
    expect(f.sent[0].html).toContain(formatInviteCode(code)); // printed to type, too
    expect(f.sent[0].html).toContain("join?email=ada%40gmail.com&amp;code=");
    expect(JSON.stringify(row)).not.toContain(code);
    expect(await inviteCodeMatches(row._id, code, hashes, "")).toBe(true);
  });

  it("the admin list never sends the hashes", () => {
    const src = readFileSync(resolve(__dirname, "../convex/access.ts"), "utf8");
    expect(src).toMatch(/page: result\.page\.map\(\(\{ inviteCodeHashes: _hashes, \.\.\.row \}\) => row\)/);
  });

  it("the join link carries the code, and the web route reads it", () => {
    expect(access.joinUrl("https://app.hookedcue.com", "ada@gmail.com", "K7QM4XRP")).toBe(
      "https://app.hookedcue.com/join?email=ada%40gmail.com&code=K7QM4XRP",
    );
    expect(routeFor("/join", "?email=ada%40gmail.com&code=K7QM4XRP")).toEqual({
      kind: "join",
      email: "ada@gmail.com",
      code: "K7QM4XRP",
    });
  });

  it("both invite emails print the code", () => {
    for (const { html } of [
      inviteEmail("Ada", "https://app.hookedcue.com/join?email=a%40b.co&code=K7QM4XRP", "K7QM4XRP"),
      inviteReminderEmail("Ada", "https://app.hookedcue.com/join?email=a%40b.co&code=K7QM4XRP", "K7QM4XRP"),
    ]) {
      expect(html).toContain("Your invite code");
      expect(html).toContain("K7QM-4XRP");
      expect(html).toContain("code=K7QM4XRP");
    }
  });

  it("the reminder carries a fresh code, and the first one still works", async () => {
    await f.run(access.approve, { emails: ["ada@gmail.com"] });
    const first = codeIn(f.sent[0].html);
    const row = f.request("ada@gmail.com")!;
    row.decidedAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    await f.run(access.remindUnjoined, {});
    expect(f.sent).toHaveLength(2);
    const second = codeIn(f.sent[1].html);
    expect(second).not.toBe(first);
    for (const code of [first, second]) {
      expect(await f.run(access.checkInviteCode, { email: "ada@gmail.com", code, ip: "1.1.1.1" })).toBe("ok");
    }
  });
});

describe("sign-up has to present the code", () => {
  const signUp = async (email: string, inviteCode?: string, ip = "203.0.113.9") => {
    const auth = createAuth(f.ctx as never) as unknown as {
      options: { databaseHooks: { user: { create: { before: Function; after: Function } } } };
    };
    const hooks = auth.options.databaseHooks.user.create;
    const context = { body: { email, password: "long-enough", name: "x", inviteCode }, headers: new Headers({ "cf-connecting-ip": ip }) };
    await hooks.before({ email, name: "x" }, context);
    // what Better Auth does next: create the user, then the after hook
    const id = `user:${email}`;
    f.authUsers.push({ _id: id, email, emailVerified: false });
    await hooks.after({ id, email }, context);
    return id;
  };

  let code = "";
  beforeEach(async () => {
    await f.run(access.approve, { emails: ["ada@gmail.com"] });
    code = codeIn(f.sent[0].html);
  });

  it("is refused without a code", async () => {
    await expect(signUp("ada@gmail.com")).rejects.toThrow(INVITE_CODE_MESSAGES.missing);
    await expect(signUp("ada@gmail.com", "  ")).rejects.toThrow(INVITE_CODE_MESSAGES.missing);
  });

  it("is refused with a wrong code", async () => {
    await expect(signUp("ada@gmail.com", "AAAAAAAA")).rejects.toThrow(INVITE_CODE_MESSAGES.wrong);
  });

  it("is refused for an address that isn't approved, code or not", async () => {
    await expect(signUp("bob@gmail.com", code)).rejects.toThrow(access.NOT_APPROVED_MESSAGE);
  });

  it("goes through with the right code, typed any way", async () => {
    const id = await signUp("ada@gmail.com", formatInviteCode(code).toLowerCase());
    const row = f.request("ada@gmail.com")!;
    expect(row.inviteClaimedBy).toBe(id);
    expect(typeof row.inviteClaimedAt).toBe("string");
  });

  it("works once", async () => {
    await signUp("ada@gmail.com", code);
    // the account was deleted from Better Auth by hand, say: the code still doesn't come back
    await expect(signUp("ada@gmail.com", code)).rejects.toThrow(INVITE_CODE_MESSAGES.used);
  });

  it("the same inbox spelled another way still needs this inbox's code", async () => {
    await expect(signUp("a.da+x@gmail.com", "AAAAAAAA")).rejects.toThrow(INVITE_CODE_MESSAGES.wrong);
    await signUp("a.da+x@gmail.com", code);
  });

  it("stops even the right code after 10 wrong ones for the inbox", async () => {
    for (let i = 0; i < access.INVITE_CODE_TRIES.email; i++) {
      await expect(signUp("ada@gmail.com", "AAAAAAAA", `198.51.100.${i}`)).rejects.toThrow(INVITE_CODE_MESSAGES.wrong);
    }
    await expect(signUp("ada@gmail.com", code, "192.0.2.1")).rejects.toThrow(INVITE_CODE_MESSAGES.limited);
    // and counts the inbox, not the spelling
    await expect(signUp("a.da@gmail.com", code, "192.0.2.2")).rejects.toThrow(INVITE_CODE_MESSAGES.limited);
  });

  it("stops one caller guessing across many inboxes", async () => {
    const emails = Array.from({ length: access.INVITE_CODE_TRIES.ip }, (_, i) => `p${i}@example.org`);
    await f.run(access.approve, { emails });
    for (const e of emails) await expect(signUp(e, "AAAAAAAA", "203.0.113.50")).rejects.toThrow(INVITE_CODE_MESSAGES.wrong);
    await expect(signUp("ada@gmail.com", code, "203.0.113.50")).rejects.toThrow(INVITE_CODE_MESSAGES.limited);
    // someone else is unaffected
    await signUp("ada@gmail.com", code, "203.0.113.51");
  });

  it("the forms ask for the code before sending", () => {
    expect(inviteCodeProblem("")).toMatch(/invite code/);
    expect(inviteCodeProblem(" - ")).toMatch(/invite code/);
    expect(inviteCodeProblem("K7QM-4XRP")).toBeNull();
  });
});

describe("access:reissueInviteCodes, for invites mailed before codes", () => {
  const oldInvite = async (email: string, extra: Record<string, unknown> = {}) =>
    f.db.insert("accessRequests", {
      email,
      emailKey: email,
      name: "Old Invite",
      source: "landing",
      status: "approved",
      submittedAt: "2026-10-01T00:00:00Z",
      decidedAt: "2026-10-02T00:00:00Z",
      invited: true,
      ...extra,
    });

  it("only picks approved, invited rows with no code that haven't been reissued or used", () => {
    const base = { status: "approved", invited: true };
    expect(access.needsReissue(base)).toBe(true);
    expect(access.needsReissue({ ...base, inviteCodeHashes: ["h"] })).toBe(false);
    expect(access.needsReissue({ ...base, inviteReissuedAt: "x" })).toBe(false);
    expect(access.needsReissue({ ...base, inviteClaimedAt: "x" })).toBe(false);
    expect(access.needsReissue({ ...base, invited: false })).toBe(false);
    expect(access.needsReissue({ ...base, status: "pending" })).toBe(false);
  });

  it("a dry run sends and changes nothing", async () => {
    await oldInvite("old@gmail.com");
    f.authUsers.push({ _id: "u-squat", email: "old@gmail.com", emailVerified: false });
    const out = (await f.run(access.reissueInviteCodes, { dryRun: true })) as Record<string, unknown>;
    expect(out).toMatchObject({ dryRun: true, mailed: ["old@gmail.com"], removedUnconfirmed: ["old@gmail.com"] });
    expect(f.sent).toHaveLength(0);
    expect(f.removedUsers).toEqual([]);
    expect(f.request("old@gmail.com")!.inviteCodeHashes).toBeUndefined();
  });

  it("mails a code once, and the code signs them up", async () => {
    await oldInvite("old@gmail.com");
    const out = (await f.run(access.reissueInviteCodes, {})) as { mailed: string[] };
    expect(out.mailed).toEqual(["old@gmail.com"]);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].subject).toMatch(/now with your code/);
    const code = codeIn(f.sent[0].html);
    const row = f.request("old@gmail.com")!;
    expect(typeof row.inviteReissuedAt).toBe("string");
    expect(await f.run(access.checkInviteCode, { email: "old@gmail.com", code, ip: "1.1.1.1" })).toBe("ok");
    // running it again sends nothing more
    await f.run(access.reissueInviteCodes, {});
    expect(f.sent).toHaveLength(1);
  });

  it("removes an unconfirmed sign-in squatting the address, leaves confirmed ones and joined people alone", async () => {
    await oldInvite("squatted@gmail.com");
    await oldInvite("confirmed@gmail.com");
    await oldInvite("joined@gmail.com");
    await f.db.insert("profiles", { email: "joined@gmail.com", userId: "u-joined" });
    f.authUsers.push(
      { _id: "u-squat", email: "squatted@gmail.com", emailVerified: false },
      { _id: "u-conf", email: "confirmed@gmail.com", emailVerified: true },
      { _id: "u-joined", email: "joined@gmail.com", emailVerified: true },
    );
    const out = (await f.run(access.reissueInviteCodes, {})) as Record<string, string[]>;
    expect(out.removedUnconfirmed).toEqual(["squatted@gmail.com"]);
    expect(out.confirmedNoProfile).toEqual(["confirmed@gmail.com"]);
    expect(out.mailed).toEqual(["squatted@gmail.com"]);
    expect(f.removedUsers).toEqual(["u-squat"]);
    expect(f.sent.map((m) => m.to)).toEqual(["squatted@gmail.com"]);
  });

  it("lists approved people who were never emailed instead of guessing", async () => {
    await oldInvite("never@gmail.com", { invited: false });
    const out = (await f.run(access.reissueInviteCodes, {})) as Record<string, string[]>;
    expect(out.neverInvited).toEqual(["never@gmail.com"]);
    expect(f.sent).toHaveLength(0);
  });
});

describe("the sign-up hook is the gate for every way an account is made", () => {
  const auth = readFileSync(resolve(__dirname, "../convex/auth.ts"), "utf8");
  it("email and password is the only sign-up: no social providers, no admin plugin", () => {
    expect(auth).not.toMatch(/socialProviders/);
    expect(auth).not.toMatch(/admin\(/);
    expect(auth).toMatch(/plugins: \[crossDomain\(\{ siteUrl \}\), convex\(\{ authConfig \}\)\]/);
  });
  it("the code is checked in databaseHooks.user.create.before, after the approval check", () => {
    const before = auth.slice(auth.indexOf("before: async (user, context)"));
    expect(before.indexOf("signupAllowed(status)")).toBeLessThan(before.indexOf("inviteStatus(ctx"));
    expect(before).toMatch(/if \(verdict !== "ok"\) \{\s*throw new APIError\("FORBIDDEN", \{ message: INVITE_CODE_MESSAGES\[verdict\] \}\)/);
  });
});

describe("both sign-up forms send the code", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
  it("web: a code box in join mode, prefilled from the invite link", () => {
    const form = read("src/components/AuthForm.tsx");
    expect(form).toMatch(/useState\(initialCode\)/);
    expect(form).toMatch(/mode === "join" && \(/);
    expect(form).toMatch(/inviteCode: inviteCode\.trim\(\)/);
    expect(read("src/components/ProfileScreen.tsx")).toMatch(/initialCode=\{joinCode \?\? ""\}/);
  });
  it.skipIf(!HAS_MOBILE)("phone: the same code box, sent with the sign-up", () => {
    const form = read("../mobile/src/components/AuthForm.tsx");
    expect(form).toMatch(/AUTH_COPY\.codeLabel/);
    expect(form).toMatch(/inviteCodeProblem\(inviteCode\)/);
    expect(form).toMatch(/inviteCode: inviteCode\.trim\(\)/);
  });
});
