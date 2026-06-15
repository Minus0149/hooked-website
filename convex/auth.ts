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
