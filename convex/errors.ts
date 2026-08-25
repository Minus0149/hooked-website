import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { cleanText, enforceRateLimit, requirePermission } from "./security";

/**
 * Crash reports from the app's error screen.
 *
 * The endpoint is deliberately a PUBLIC mutation: the report button has to
 * work when the session is half-dead, which is exactly when auth is least
 * reliable. Abuse is bounded the boring way — per-identity rate limits and
 * hard size caps — and the only thing stored is what the sender typed plus
 * the error itself.
 */

const CAPS = {
  message: 500,
  stack: 8000,
  componentStack: 8000,
  description: 1000,
  platform: 20,
  appVersion: 40,
  url: 300,
} as const;

const opt = (raw: unknown, cap: number) =>
  typeof raw === "string" && raw.length > 0 ? cleanText(raw, cap) : undefined;

export const report = mutation({
  args: {
    message: v.string(),
    stack: v.optional(v.string()),
    componentStack: v.optional(v.string()),
    description: v.optional(v.string()),
    platform: v.string(),
    appVersion: v.optional(v.string()),
    url: v.optional(v.string()),
    /** stable per-install id — the same one the ad caps use */
    anonKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    const anonKey = args.anonKey ? cleanText(args.anonKey, 64) : undefined;
    if (!user && !anonKey) throw new Error("No identity");

    const identity = user ? String(user._id) : `anon:${anonKey}`;
    await enforceRateLimit(ctx, `err-report:${identity}`, 10, 60 * 60_000);

    let userEmail: string | undefined;
    if (user) {
      userEmail = user.email ?? undefined;
    }

    await ctx.db.insert("errorReports", {
      message: cleanText(args.message, CAPS.message) || "unknown error",
      stack: opt(args.stack, CAPS.stack),
      componentStack: opt(args.componentStack, CAPS.componentStack),
      description: opt(args.description, CAPS.description),
      platform: cleanText(args.platform, CAPS.platform) || "unknown",
      appVersion: opt(args.appVersion, CAPS.appVersion),
      url: opt(args.url, CAPS.url),
      userId: user ? String(user._id) : undefined,
      userEmail,
      anonKey: user ? undefined : anonKey,
      at: Date.now(),
    });
  },
});

/** The inbox. Admin-only, newest first. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "users.view");
    const rows = await ctx.db
      .query("errorReports")
      .order("desc")
      .take(50);
    return rows;
  },
});
