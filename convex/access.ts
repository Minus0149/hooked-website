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

/** Shared by the public mutation and the landing webhook, so both validate identically. */
async function upsertRequest(
  ctx: { db: any },
  input: Incoming,
): Promise<{ status: "pending" | "approved" | "rejected"; duplicate: boolean }> {
  const email = cleanText(input.email, MAX.email).toLowerCase();
  const name = cleanText(input.name, MAX.name);

  if (!EMAIL_RE.test(email)) throw new Error("A real email address is required");
  if (name.length < 2) throw new Error("A name is required");

  const existing = await ctx.db
    .query("accessRequests")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();

  // Never let a re-submission reset a decision — someone who's been rejected
  // can't clear it by filling the form again.
  if (existing) return { status: existing.status, duplicate: true };

  await ctx.db.insert("accessRequests", {
    email,
    name,
    source: input.source,
    status: "pending" as const,
    device: input.device ? cleanText(input.device, MAX.device) : undefined,
    androidVersion: input.androidVersion ? cleanText(input.androidVersion, 40) : undefined,
    listensOn: cleanList(input.listensOn),
    genres: cleanList(input.genres),
    hours: input.hours ? cleanText(input.hours, MAX.hours) : undefined,
    lastSkipped: input.lastSkipped ? cleanText(input.lastSkipped, MAX.lastSkipped) : undefined,
    notes: input.notes ? cleanText(input.notes, MAX.notes) : undefined,
    submittedAt: new Date().toISOString(),
    userAgent: input.userAgent ? cleanText(input.userAgent, MAX.userAgent) : undefined,
    invited: false,
  });

  return { status: "pending", duplicate: false };
}

/** The in-app wall posts here. Public and unauthenticated, so it's rate limited by email. */
export const apply = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    device: v.optional(v.string()),
    listensOn: v.optional(v.array(v.string())),
    genres: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = cleanText(args.email, MAX.email).toLowerCase() || "anon";
    await enforceRateLimit(ctx, `access:${key}`, 5, 10 * 60_000);
    return await upsertRequest(ctx, { ...args, source: "app" });
  },
});

/** Lets the UI say "you're already in the queue" instead of making them guess. */
export const statusFor = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const clean = cleanText(email, MAX.email).toLowerCase();
    if (!EMAIL_RE.test(clean)) return { status: "none" as const };
    const row = await ctx.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", clean))
      .unique();
    return { status: (row?.status ?? "none") as "none" | "pending" | "approved" | "rejected" };
  },
});

/** Called by the /beta HTTP route for landing-site submissions. */
export const record = internalMutation({
  args: {
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
  handler: async (ctx, args) => await upsertRequest(ctx, { ...args, source: "landing" }),
});

/** The admin queue. Behind the existing users.view permission — no new access path. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "users.view");
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

/** Tick someone off once their Play Store invite has actually gone out. */
export const markInvited = mutation({
  args: { id: v.id("accessRequests"), invited: v.boolean() },
  handler: async (ctx, { id, invited }) => {
    await requirePermission(ctx, "users.manage");
    await ctx.db.patch(id, { invited });
  },
});
