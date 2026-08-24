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
        const key = process.env.RESEND_API_KEY;
        const from = process.env.RESEND_FROM ?? "hooked <onboarding@resend.dev>";
        if (!key) {
          console.warn(
            `[auth] password reset for ${user.email}: ${url} — set RESEND_API_KEY to email these`,
          );
          return;
        }
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              from,
              to: [user.email],
              subject: "reset your hooked. password",
              html:
                `<p>Someone (hopefully you) asked to reset the password for <b>${user.email}</b>.</p>` +
                `<p><a href="${url}">Choose a new password</a> — the link works once and expires in an hour.</p>` +
                `<p>If it wasn't you, ignore this and your password stays as it was.</p>`,
            }),
          });
          if (!res.ok) {
            console.error("[auth] reset email failed:", await res.text());
          }
        } catch (err) {
          console.error("[auth] reset email error:", err);
        }
      },
      resetPasswordTokenExpiresIn: 3600,
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
