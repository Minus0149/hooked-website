import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  cleanText,
  enforceRateLimit,
  getProfile,
  requirePermission,
  requireUser,
} from "./security";

/**
 * Access requests — the approval queue.
 *
 * Two ways in: the landing site's beta form (via the /beta HTTP route) and the
 * in-app wall once the free swipes run out. Both land here. An account can only
 * be created once its email has been approved — that check lives in
 * library.ensureProfile, not in the UI, so it can't be clicked past.
 */

const MAX = {
  name: 60,
  email: 200,
  device: 80,
  hours: 40,
  lastSkipped: 120,
  notes: 500,
  userAgent: 200,
  listItem: 40,
} as const;

const LIST_CAP = 12;

// deliberately loose — this rejects obvious junk, not RFC violations
const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/;

const cleanList = (values: string[] | undefined) => {
  if (!values) return undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanText(value, MAX.listItem).toLowerCase();
    if (cleaned) seen.add(cleaned);
    if (seen.size >= LIST_CAP) break;
  }
  return [...seen];
};

type Incoming = {
  email: string;
  name: string;
  source: "app" | "landing";
  device?: string;
  androidVersion?: string;
  listensOn?: string[];
  genres?: string[];
  hours?: string;
  lastSkipped?: string;
  notes?: string;
  userAgent?: string;
};

/**
 * The name to store. Signing up asks for the email first and the name only
 * optionally — every extra field on a signup form loses people, and the
 * email is the only thing an invite needs. Without one, the part of the
 * address before the @ stands in, so the admin queue still reads as people.
 */
export function nameFor(name: string, email: string): string {
  const given = cleanText(name, MAX.name);
  if (given.length >= 2) return given;
  const local = cleanText(email, MAX.email).split("@")[0] ?? "";
  return local.length >= 2 ? local.slice(0, MAX.name) : "listener";
}

/** The optional details a request can carry, cleaned. */
export function detailFields(input: Omit<Incoming, "email" | "name" | "source">) {
  return {
    device: input.device ? cleanText(input.device, MAX.device) || undefined : undefined,
    androidVersion: input.androidVersion ? cleanText(input.androidVersion, 40) || undefined : undefined,
    listensOn: cleanList(input.listensOn),
    genres: cleanList(input.genres),
    hours: input.hours ? cleanText(input.hours, MAX.hours) || undefined : undefined,
    lastSkipped: input.lastSkipped ? cleanText(input.lastSkipped, MAX.lastSkipped) || undefined : undefined,
    notes: input.notes ? cleanText(input.notes, MAX.notes) || undefined : undefined,
  };
}

type Details = ReturnType<typeof detailFields>;

/**
 * What a second submission from the same email may add: details the first
 * one left empty. The signup is two steps — email, then an optional "help us
 * tune it" — so the second step arrives as a resubmission.
 *
 * It only ever fills blanks, and only while the request is pending: it can't
 * overwrite what's there, and it can't touch the decision. Someone who knows
 * an address can add a phone model to a pending row, which is harmless; they
 * can't change or read anything.
 */
export function detailsPatch(
  existing: Partial<Record<keyof Details, unknown>> & { status: string },
  incoming: Details,
): Partial<Details> {
  if (existing.status !== "pending") return {};
  const patch: Partial<Details> = {};
  for (const key of Object.keys(incoming) as (keyof Details)[]) {
    const next = incoming[key];
    const empty = Array.isArray(next) ? next.length === 0 : next === undefined;
    if (empty) continue;
    const have = existing[key];
    const haveEmpty = have === undefined || have === null || have === "" || (Array.isArray(have) && have.length === 0);
    if (haveEmpty) (patch as Record<string, unknown>)[key] = next;
  }
  return patch;
}

/** Shared by the public mutation and the landing webhook, so both validate identically. */
async function upsertRequest(
  ctx: { db: any },
  input: Incoming,
): Promise<{ status: "pending" | "approved" | "rejected"; duplicate: boolean }> {
  const email = cleanText(input.email, MAX.email).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("A real email address is required");
  const name = nameFor(input.name, email);
  const details = detailFields(input);

  const existing = await ctx.db
    .query("accessRequests")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();

  // Never let a re-submission reset a decision — someone who's been rejected
  // can't clear it by filling the form again. A pending one may fill in the
  // details it left out (the optional second step).
  if (existing) {
    const patch = detailsPatch(existing, details);
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return { status: existing.status, duplicate: true };
  }

  await ctx.db.insert("accessRequests", {
    email,
    name,
    source: input.source,
    status: "pending" as const,
    ...details,
    submittedAt: new Date().toISOString(),
    userAgent: input.userAgent ? cleanText(input.userAgent, MAX.userAgent) : undefined,
    invited: false,
  });

  return { status: "pending", duplicate: false };
}

/**
 * The in-app wall submits here, via the /access/apply HTTP route.
 *
 * Internal rather than public on purpose: a public mutation arrives over the
 * websocket client where there is no client IP to limit on, so the only ceiling
 * would be per-email — and emails are free. Routing through an HTTP action lets
 * us see cf-connecting-ip and limit the actual caller.
 */
export const submit = internalMutation({
  args: {
    ip: v.string(),
    email: v.string(),
    name: v.string(),
    device: v.optional(v.string()),
    listensOn: v.optional(v.array(v.string())),
    genres: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { ip, ...args }) => {
    // per-IP first: the ceiling that actually costs an attacker something
    await enforceRateLimit(ctx, `access:ip:${ip}`, 8, 60 * 60_000);
    const key = cleanText(args.email, MAX.email).toLowerCase() || "anon";
    await enforceRateLimit(ctx, `access:email:${key}`, 5, 10 * 60_000);
    // and a floor under the whole queue, so a botnet spread across many IPs
    // can't fill the table one "valid" row at a time
    await enforceRateLimit(ctx, "access:global", 300, 60 * 60_000);
    return await upsertRequest(ctx, { ...args, source: "app" });
  },
});

/** Called by the /beta HTTP route for landing-site submissions. */
export const record = internalMutation({
  args: {
    ip: v.optional(v.string()),
    email: v.string(),
    name: v.string(),
    device: v.optional(v.string()),
    androidVersion: v.optional(v.string()),
    listensOn: v.optional(v.array(v.string())),
    genres: v.optional(v.array(v.string())),
    hours: v.optional(v.string()),
    lastSkipped: v.optional(v.string()),
    notes: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { ip, ...args }) => {
    // the landing server is trusted, but the shared secret could leak
    if (ip) await enforceRateLimit(ctx, `access:ip:${ip}`, 30, 60 * 60_000);
    await enforceRateLimit(ctx, "access:global", 300, 60 * 60_000);
    return await upsertRequest(ctx, { ...args, source: "landing" });
  },
});

/** The admin queue. Behind the existing users.view permission — no new access path. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    // null, not a throw: the dashboard reads null as "not yours to see", and a
    // throw here took the whole app down for anyone whose token was still
    // arriving when the page loaded
    try {
      await requirePermission(ctx, "users.view");
    } catch {
      return null;
    }
    const rows = await ctx.db.query("accessRequests").collect();
    rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      total: rows.length,
      pending: count("pending"),
      approved: count("approved"),
      rejected: count("rejected"),
      fromApp: rows.filter((r) => r.source === "app").length,
      fromLanding: rows.filter((r) => r.source === "landing").length,
      requests: rows,
    };
  },
});

/** Approve or reject. Approval is what unlocks account creation for that email. */
export const decide = mutation({
  args: {
    id: v.id("accessRequests"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
  },
  handler: async (ctx, { id, status }) => {
    await requirePermission(ctx, "users.manage");
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    await ctx.db.patch(id, {
      status,
      decidedAt: new Date().toISOString(),
      decidedBy: profile?.email ?? user.id,
    });
  },
});

/**
 * Drop a request entirely. Rejecting keeps a record on purpose, so this is for
 * the rows that shouldn't be counted at all — spam on a public form, and test
 * submissions. They'd otherwise sit in the funnel forever, making the approval
 * rate look worse than it is.
 *
 * Refuses to delete a request that has already become an account, so this can't
 * be used to quietly cut someone's access off.
 */
export const remove = mutation({
  args: { id: v.id("accessRequests") },
  handler: async (ctx, { id }) => {
    const { user } = await requirePermission(ctx, "users.manage");
    await enforceRateLimit(ctx, `access:remove:${user.id}`, 60, 60 * 60_000);
    const row = await ctx.db.get(id);
    if (!row) return;
    const existing = (await ctx.db.query("profiles").collect()).some(
      (p) => p.email.toLowerCase() === row.email.toLowerCase(),
    );
    if (existing) {
      throw new Error(
        "That email already has an account — reject it instead, or delete the user from Users.",
      );
    }
    await ctx.db.delete(id);
  },
});

/** Tick someone off once their Play Store invite has actually gone out. */
export const markInvited = mutation({
  args: { id: v.id("accessRequests"), invited: v.boolean() },
  handler: async (ctx, { id, invited }) => {
    await requirePermission(ctx, "users.manage");
    await ctx.db.patch(id, { invited });
  },
});

/**
 * Normalise an operator's list of emails: lowercase, trimmed, de-duplicated,
 * and split into the addresses we can store and the ones we can't.
 */
export function operatorEmails(list: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of list) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) invalid.push(raw);
    else if (!valid.includes(email)) valid.push(email);
  }
  return { valid, invalid };
}

/**
 * Approve people from the command line. Operator-only: internal, so no client
 * can call it — only `npx convex run` by someone holding deploy access, the
 * same trust as admin:grantAdmin. For the Play reviewer's account and for
 * pre-approving closed-test testers before any admin exists:
 *
 *   npx convex run --prod access:approve '{"emails":["a@gmail.com","b@gmail.com"]}'
 *
 * An existing request is approved (a rejection included — the operator is
 * vouching); a new one is created already approved. Approval alone is not
 * access: the person still signs up and confirms their email (profileGate).
 */
export const approve = internalMutation({
  args: { emails: v.array(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { emails, note }) => {
    const { valid, invalid } = operatorEmails(emails);
    const now = new Date().toISOString();
    const done: { email: string; was: string }[] = [];
    for (const email of valid) {
      const existing = await ctx.db
        .query("accessRequests")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { status: "approved", decidedAt: now, decidedBy: "operator" });
        done.push({ email, was: existing.status });
      } else {
        await ctx.db.insert("accessRequests", {
          email,
          name: nameFor("", email),
          source: "landing",
          status: "approved",
          notes: cleanText(note ?? "added by operator", MAX.notes),
          submittedAt: now,
          decidedAt: now,
          decidedBy: "operator",
          invited: false,
        });
        done.push({ email, was: "new" });
      }
    }
    return { approved: done, invalid };
  },
});
