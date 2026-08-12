import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

/**
 * The Better Auth helper derives *both* the issuer and the JWKS fetch URL from
 * `CONVEX_SITE_URL`. On this self-hosted deployment that variable points at the
 * dashboard domain and carries a trailing slash, so Convex was trying to read
 * signing keys from
 *
 *   https://convexdash.hookedcue.com//api/auth/convex/jwks   -> 404
 *
 * The dashboard doesn't serve HTTP actions; cnx.hookedcue.com does. Every token
 * minted correctly and then failed validation, so `ctx.auth.getUserIdentity()`
 * came back empty and `ensureProfile` ran as nobody — which presents as "signed
 * in, but the app acts like you aren't, and no profile is ever created".
 *
 * The issuer has to keep matching the `iss` claim, and that claim comes from the
 * same CONVEX_SITE_URL, so it stays as the library set it. Only the fetch URL is
 * corrected, to the domain that actually answers.
 */
const authSiteUrl = (process.env.BETTER_AUTH_URL ?? "https://cnx.hookedcue.com").replace(
  /\/+$/,
  "",
);

export default {
  providers: [
    {
      ...getAuthConfigProvider(),
      jwks: `${authSiteUrl}/api/auth/convex/jwks`,
    },
  ],
} satisfies AuthConfig;
