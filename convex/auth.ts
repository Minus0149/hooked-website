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
import { NOT_APPROVED_MESSAGE, approvalRow, signupAllowed } from "./access";
import { DISPOSABLE_MESSAGE, isDisposableEmail } from "./emailIdentity";
import { AUTH_RATE_LIMIT, authTrustedOrigins } from "./authLimits";

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
    db?: Parameters<typeof approvalRow>[0]["db"];
  };
  if (c.runQuery) return c.runQuery(internal.access.approvalFor, { email });
  // the same lookup approvalFor makes: exact address, then the same inbox
  if (c.db) return (await approvalRow({ db: c.db }, email))?.status ?? null;
  return null;
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: authSiteUrl,
    secret: authSecret,
    // the web SPA and the phone app's own scheme; never "exp://" (authLimits.ts)
    trustedOrigins: authTrustedOrigins(siteUrl),
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"],
      },
    },
    // per IP and path; the email-sending routes are held to a few an hour
    rateLimit: AUTH_RATE_LIMIT,
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
      // a reset is how someone takes their account back: whoever had the old
      // password (or a stolen session) is signed out everywhere by it
      revokeSessionsOnPasswordReset: true,
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
    // Accounts are invite-only: HookedCue is a beta you apply for, and only an
    // approved email may create an account. Everyone else gets the message and
    // the app points them at the application form.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // a request from a temporary inbox is refused, so this only bites
            // an approval made before the list existed
            if (isDisposableEmail(String(user.email ?? ""))) {
              throw new APIError("FORBIDDEN", { message: DISPOSABLE_MESSAGE });
            }
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
