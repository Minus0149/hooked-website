import type { AuthConfig } from "convex/server";

const convexSiteUrl = process.env.CONVEX_SITE_URL ?? "https://cnx.hookedcue.com";

export default {
  providers: [
    {
      type: "customJwt",
      issuer: convexSiteUrl,
      applicationID: "convex",
      algorithm: "RS256",
      jwks: `${convexSiteUrl}/api/auth/convex/jwks`,
    },
  ],
} satisfies AuthConfig;
