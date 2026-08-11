import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { cleanText, requirePermission } from "./security";

/**
 * Beta signups from the landing site.
 *
 * The landing form validates first, but this validates again — the HTTP route is
 * reachable by anything holding the ingest secret, so it cannot trust its caller.
 */

const MAX = {
  name: 60,
  email: 200,
  device: 80,
  lastSkipped: 120,
  notes: 500,
  userAgent: 200,
} as const;

const LIST_CAP = 12;

const cleanList = (values: string[], cap: number) => {
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanText(value, 40).toLowerCase();
    if (cleaned) seen.add(cleaned);
    if (seen.size >= cap) break;
  }
  return [...seen];
};

export const record = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    device: v.string(),
    androidVersion: v.optional(v.string()),
    listensOn: v.optional(v.array(v.string())),
    genres: v.optional(v.array(v.string())),
    hours: v.optional(v.string()),
    lastSkipped: v.optional(v.string()),
    notes: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = cleanText(args.email, MAX.email).toLowerCase();
    const name = cleanText(args.name, MAX.name);
    const device = cleanText(args.device, MAX.device);

    if (!email.includes("@") || !name || !device) {
      throw new Error("Missing required signup fields");
    }

    const existing = await ctx.db
      .query("betaSignups")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) return { duplicate: true };

    await ctx.db.insert("betaSignups", {
      name,
      email,
      device,
      androidVersion: cleanText(args.androidVersion ?? "", 40),
      listensOn: cleanList(args.listensOn ?? [], LIST_CAP),
      genres: cleanList(args.genres ?? [], LIST_CAP),
      hours: cleanText(args.hours ?? "", 40),
      lastSkipped: cleanText(args.lastSkipped ?? "", MAX.lastSkipped),
      notes: cleanText(args.notes ?? "", MAX.notes),
      submittedAt: new Date().toISOString(),
      userAgent: cleanText(args.userAgent ?? "", MAX.userAgent),
      invited: false,
    });

    return { duplicate: false };
  },
});

/** Dashboard list. Reuses the existing permission model — no new access path. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "users.view");
    const rows = await ctx.db.query("betaSignups").collect();
    rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return {
      total: rows.length,
      invited: rows.filter((r) => r.invited).length,
      signups: rows,
    };
  },
});

/** Tick people off as their play store invite goes out. */
export const markInvited = mutation({
  args: { id: v.id("betaSignups"), invited: v.boolean() },
  handler: async (ctx, { id, invited }) => {
    await requirePermission(ctx, "users.manage");
    await ctx.db.patch(id, { invited });
  },
});
