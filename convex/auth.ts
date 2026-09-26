import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { smtpSettings } from "./emailConfig";
import { resetEmail, verifyEmail } from "./emailTemplate";
import { APIError } from "better-auth/api";
import { NOT_APPROVED_MESSAGE, signupAllowed } from "./access";

const siteUrl = process.env.SITE_URL ?? "https://app.hookedcue.com";
// falls back to the deployment's own HTTP URL, which Convex provides to every function
const authSiteUrl = process.env.BETTER_AUTH_URL ?? process.env.CONVEX_SITE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Hand one transactional email to the SMTP sender (convex/email.ts). Without
 * the SMTP settings the link is logged to the Convex dashboard instead — the
 * honest fallback, and enough to pass a link to a tester by hand.
 */
async function sendEmail(
  ctx: GenericCtx<DataModel>,
  to: string,
  subject: string,
  html: string,
  logLine: string,
) {
  const smtp = smtpSettings(process.env);
  if (!smtp.ok) {
    console.warn(`[auth] ${logLine} — set ${smtp.missing.join(", ")} to email these`);
    return;
  }
  if (!("scheduler" in ctx)) {
    console.error(`[auth] ${subject}: no scheduler in this context, email not queued`);
    return;
  }
  await ctx.scheduler.runAfter(0, internal.email.send, { to, subject, html });
}

/**
 * The approval status of an email, from whichever context Better Auth hands
 * the hook: sign-up arrives through an HTTP action (runQuery), but the adapter
 * can also run inside a mutation (db).
 */
async function approvalStatus(ctx: GenericCtx<DataModel>, email: string): Promise<string | null> {
  const c = ctx as unknown as {
    runQuery?: (fn: typeof internal.access.approvalFor, args: { email: string }) => Promise<string | null>;
    db?: { query: (t: "accessRequests") => { withIndex: (i: "by_email", f: (q: { eq: (k: "email", v: string) => unknown }) => unknown) => { unique: () => Promise<{ status: string } | null> } } };
  };
  if (c.runQuery) return c.runQuery(internal.access.approvalFor, { email });
  if (c.db) {
    const row = await c.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    return row?.status ?? null;
  }
  return null;
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: authSiteUrl,
    secret: authSecret,
    // web SPA + the Expo app (dev client scheme and Expo Go)
    trustedOrigins: [siteUrl, "hooked://", "exp://"],
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"],
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/*": { window: 60, max: 5 },
        "/sign-up/*": { window: 60 * 60, max: 10 },
        "/convex/token": { window: 60, max: 60 },
        "/get-session": { window: 60, max: 120 },
      },
    },
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      // Password resets need somewhere to send the link: our own mail server
      // (see sendEmail). Without SMTP settings the link is logged instead.
      sendResetPassword: async ({ user, url }) => {
        const mail = resetEmail(user.email, url);
        await sendEmail(ctx, user.email, mail.subject, mail.html, `password reset for ${user.email}: ${url}`);
      },
      resetPasswordTokenExpiresIn: 3600,
    },
    // Signing up with an address proves nothing about owning it. An approved
    // invite only counts once the inbox has clicked this link — otherwise the
    // first stranger to type an invited person's email took their place.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        const mail = verifyEmail(user.email, url);
        await sendEmail(ctx, user.email, mail.subject, mail.html, `verify ${user.email}: ${url}`);
      },
    },
    // Accounts are invite-only: hookedcue is a beta you apply for, and only an
    // approved email may create an account. Everyone else gets the message and
    // the app points them at the application form.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const status = await approvalStatus(ctx, String(user.email ?? ""));
            if (!signupAllowed(status)) {
              throw new APIError("FORBIDDEN", { message: NOT_APPROVED_MESSAGE });
            }
          },
        },
      },
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.safeGetAuthUser(ctx);
  },
});
