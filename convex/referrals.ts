import { mutation, query, type QueryCtx } from "./_generated/server";
import { runtimeFor } from "./runtime";
import { getProfile, requirePermission, requireUser } from "./security";
import { inviteLink, isFoundingListener, makeCode } from "./referralRules";

/**
 * Invite a friend — see referralRules.ts for the rules and access.ts
 * (applyReferral) for where a code turns an application into an approval.
 */

const LANDING = () => process.env.LANDING_URL ?? "https://hookedcue.com";

async function codeFor(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("referralCodes")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
}

async function joinedByEmail(ctx: QueryCtx, email: string): Promise<boolean> {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  return profile !== null;
}

/** The signed-in listener's invite link, allowance and who came through it. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch {
      return null;
    }
    const profile = await getProfile(ctx, user.id);
    if (!profile) return null;
    const runtime = await runtimeFor(ctx);
    const code = await codeFor(ctx, user.id);
    const invited = await ctx.db
      .query("accessRequests")
      .withIndex("by_referredBy", (q) => q.eq("referredBy", user.id))
      .collect();
    const people = await Promise.all(
      invited.map(async (r) => ({
        // their name only — never the friend's email: the inviter didn't
        // necessarily know which address their friend applied with
        name: r.name,
        joined: await joinedByEmail(ctx, r.email),
        at: r.decidedAt ?? r.submittedAt,
      })),
    );
    people.sort((a, b) => b.at.localeCompare(a.at));
    const joined = people.filter((p) => p.joined).length;
    const cap = runtime.referralCap;
    return {
      enabled: cap > 0,
      code: code?.code ?? null,
      link: code ? inviteLink(LANDING(), code.code) : null,
      cap,
      used: people.length,
      remaining: Math.max(0, cap - people.length),
      joined,
      foundingListener: isFoundingListener(joined),
      people,
    };
  },
});

/** Create the listener's code the first time they open the invite card. */
export const ensureCode = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const profile = await getProfile(ctx, user.id);
    if (!profile) throw new Error("Only listeners with an account get an invite link");
    const existing = await codeFor(ctx, user.id);
    if (existing) return existing.code;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = makeCode(Math.random);
      const clash = await ctx.db
        .query("referralCodes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (clash) continue;
      await ctx.db.insert("referralCodes", { code, userId: user.id, createdAt: Date.now() });
      return code;
    }
    throw new Error("Couldn't make an invite code — try again");
  },
});

/** Admin: how invites are doing. */
export const adminStats = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requirePermission(ctx, "users.view");
    } catch {
      return null;
    }
    const runtime = await runtimeFor(ctx);
    const codes = await ctx.db.query("referralCodes").collect();
    // every request that came in through someone's link (the index skips the rest)
    const referred = await ctx.db
      .query("accessRequests")
      .withIndex("by_referredBy", (q) => q.gt("referredBy", ""))
      .collect();
    const byInviter = new Map<string, { approved: number; joined: number }>();
    let joined = 0;
    for (const r of referred) {
      const isIn = await joinedByEmail(ctx, r.email);
      if (isIn) joined++;
      const k = r.referredBy as string;
      const cur = byInviter.get(k) ?? { approved: 0, joined: 0 };
      cur.approved++;
      if (isIn) cur.joined++;
      byInviter.set(k, cur);
    }
    const top = await Promise.all(
      [...byInviter.entries()]
        .sort((a, b) => b[1].joined - a[1].joined || b[1].approved - a[1].approved)
        .slice(0, 10)
        .map(async ([userId, s]) => {
          const p = await getProfile(ctx, userId);
          return { email: p?.email ?? "(deleted account)", ...s, foundingListener: isFoundingListener(s.joined) };
        }),
    );
    return {
      cap: runtime.referralCap,
      codes: codes.length,
      approvedViaInvite: referred.length,
      joined,
      top,
    };
  },
});
