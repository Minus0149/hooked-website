/**
 * Better Auth's rate limits for HookedCue (used by convex/auth.ts).
 *
 * Counted per client IP and path. On Convex Cloud the *.convex.site domain is
 * behind Cloudflare, which sets cf-connecting-ip itself and refuses a request
 * that tries to supply its own (error 1000), so the IP can't be spoofed by
 * header. Pure data, no Convex imports, so tests/security-auth-limits.test.ts
 * reads it directly.
 *
 * Better Auth's built-in defaults let anyone ask for 3 password-reset or
 * verification emails a minute from one address (180 an hour) — enough to
 * bomb someone's inbox from a single laptop. The email-sending routes are
 * held to a handful an hour instead; nobody needs more than that.
 */
export const AUTH_RATE_LIMIT = {
  enabled: true,
  storage: "database" as const,
  window: 60,
  max: 120,
  customRules: {
    "/sign-in/*": { window: 60, max: 5 },
    "/sign-up/*": { window: 60 * 60, max: 10 },
    // routes that send an email to whatever address the caller names
    "/request-password-reset": { window: 60 * 60, max: 5 },
    "/forget-password": { window: 60 * 60, max: 5 },
    "/send-verification-email": { window: 60 * 60, max: 5 },
    // guessing a reset token, or a signed-in session guessing its own password
    "/reset-password": { window: 10 * 60, max: 10 },
    "/change-password": { window: 10 * 60, max: 5 },
    "/convex/token": { window: 60, max: 60 },
    "/get-session": { window: 60, max: 120 },
  },
};

/**
 * Where Better Auth may send someone after a link (callbackURL, redirectTo)
 * and which Origin headers it accepts.
 *
 * Better Auth matches a non-http origin as a prefix, so the "exp://" entry
 * that used to be here trusted every exp:// URL on any host. Anyone could ask
 * for a password reset for someone else's email with redirectTo set to
 * exp://their-server/--/x; the genuine reset email then bounced the reader
 * there with ?token=<reset token> appended, and on a phone with Expo Go
 * installed that opens Expo Go, which fetches the URL from the attacker's
 * server, token included. Nothing needs it: the phone app sends no Origin
 * header and its callbacks are the https web app.
 *
 * "hooked://" went too, for the same reason: any Android app can register the
 * hooked scheme, so redirectTo=hooked://x on someone else's reset handed the
 * token to whichever app answered. No flow used it: the phone's sign-up,
 * verification and reset callbacks are all https://app.hookedcue.com, and it
 * sends expo-origin, never Origin (the server has no expo() plugin to read it).
 */
export function authTrustedOrigins(siteUrl: string): string[] {
  return [siteUrl];
}
