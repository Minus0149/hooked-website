import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL ?? "https://app.hookedcue.com";
const authSiteUrl = process.env.BETTER_AUTH_URL ?? "https://cnx.hookedcue.com";
const authSecret = process.env.BETTER_AUTH_SECRET;

export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Send one transactional email through Resend's plain HTTPS API. Without a key
 * the link is logged to the Convex dashboard instead — the honest fallback, and
 * enough to hand a link to a tester by hand while email isn't set up.
 */
async function sendEmail(to: string, subject: string, html: string, logLine: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "hooked <onboarding@resend.dev>";
  if (!key) {
    console.warn(`[auth] ${logLine} — set RESEND_API_KEY to email these`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) console.error(`[auth] ${subject} failed:`, await res.text());
  } catch (err) {
    console.error(`[auth] ${subject} error:`, err);
  }
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
      // Password resets need somewhere to send the link. Resend's plain HTTPS
      // API keeps this dependency-free; without a key the link is logged to
      // the Convex dashboard instead, which is the honest self-host fallback.
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          user.email,
          "reset your hooked. password",
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
          user.email,
          "confirm your email for hooked.",
          `<p>Confirm <b>${user.email}</b> to finish setting up hooked.</p>` +
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
