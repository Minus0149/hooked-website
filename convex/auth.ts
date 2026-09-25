import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { smtpSettings } from "./emailConfig";

const siteUrl = process.env.SITE_URL ?? "https://app.hookedcue.com";
const authSiteUrl = process.env.BETTER_AUTH_URL ?? "https://cnx.hookedcue.com";
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
        await sendEmail(
          ctx,
          user.email,
          "reset your hookedcue password",
          `<p>Someone (hopefully you) asked to reset the password for <b>${user.email}</b>.</p>` +
            `<p><a href="${url}">Choose a new password</a> — the link works once and expires in an hour.</p>` +
            `<p>If it wasn't you, ignore this and your password stays as it was.</p>`,
          `password reset for ${user.email}: ${url}`,
        );
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
        await sendEmail(
          ctx,
          user.email,
          "confirm your email for hookedcue",
          `<p>Confirm <b>${user.email}</b> to finish setting up hookedcue.</p>` +
            `<p><a href="${url}">Confirm my email</a> — the link works for 24 hours.</p>` +
            `<p>If you didn't sign up, ignore this.</p>`,
          `verify ${user.email}: ${url}`,
        );
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
