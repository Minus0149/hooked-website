# Self-hosted Convex deployment

The production app is configured for these domains:

- App: `https://app.hookedcue.com`
- Convex backend: `https://convex.hookedcue.com`
- Convex HTTP/auth site: `https://cnx.hookedcue.com`
- Convex dashboard: `https://convexdash.hookedcue.com`

Required frontend build variables:

```env
VITE_CONVEX_URL=https://convex.hookedcue.com
VITE_CONVEX_SITE_URL=https://cnx.hookedcue.com
```

Required Convex server variables:

```env
SITE_URL=https://app.hookedcue.com
BETTER_AUTH_URL=https://cnx.hookedcue.com
BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>
```

`CONVEX_SELF_HOSTED_ADMIN_KEY` is only for the CLI when deploying to the self-hosted Convex server. Do not expose it to the browser, and do not prefix it with `VITE_`.

Do not set `CONVEX_SITE_URL` manually on self-hosted Convex. It is a Convex built-in variable and the CLI rejects overriding it.

The dashboard domain must not be used for auth. This URL should return JWKS keys:

```text
https://cnx.hookedcue.com/api/auth/convex/jwks
```

This URL should not be used and returns a dashboard 404:

```text
https://convexdash.hookedcue.com/api/auth/convex/jwks
```

The browser errors below mean the Convex functions and HTTP routes have not been deployed to the self-hosted backend yet:

- `Could not find public function for 'library:getLibrary'`
- `No 'Access-Control-Allow-Origin' header is present`
- `GET https://cnx.hookedcue.com/api/auth/get-session net::ERR_FAILED`

Deploy from `C:\Users\minus\hooked\web` with the self-hosted backend URL and the admin key from your Convex server:

```powershell
$env:CONVEX_SELF_HOSTED_URL = "https://convex.hookedcue.com"
$env:CONVEX_SELF_HOSTED_ADMIN_KEY = "<admin-key-from-your-convex-server>"

npx convex env set SITE_URL "https://app.hookedcue.com"
npx convex env set BETTER_AUTH_URL "https://cnx.hookedcue.com"
npx convex env set BETTER_AUTH_SECRET "<random-32-byte-secret>"
npx convex deploy
```

## Access control (added 2026-08-12)

The app is invite-only. Signing in is not enough — `library.ensureProfile`
refuses to create a profile unless the email has an **approved** row in
`accessRequests`, so an unapproved account has no data and no access. Requests
arrive from two places and land in one queue: the in-app wall after the free
swipes, and the landing site's `/beta` form via the HTTP route.

Two more env vars are needed on the Convex deployment:

```powershell
# Who gets the admin dashboard. Replaces the old "first account ever becomes
# admin" rule, which on an empty production database handed the dashboard to
# whichever stranger signed up first. Must match the sign-in email exactly.
npx convex env set ADMIN_EMAILS "minus4399@gmail.com"

# shared secret for the landing site's /beta ingest route
npx convex env set BETA_INGEST_SECRET "<random 32 bytes>"

# shared secret for the external hook analyzer (web/scripts/analyze-hooks.mjs)
npx convex env set HOOK_ANALYZE_KEY "<random 32 bytes>"
```

Then set the matching pair on the landing deployment:

```
BETA_WEBHOOK_URL=https://cnx.hookedcue.com/beta
BETA_WEBHOOK_SECRET=<the same random 32 bytes>
```

Existing accounts are unaffected — `ensureProfile` returns early for anyone who
already has a profile, so switching this on cannot lock out current users.

If the production database is empty after the deploy, import the seed tracks:

```powershell
npx convex import --table tracks tracks-seed.jsonl
```

Do not use `convexdash.hookedcue.com` as the app Convex URL or auth site URL. The dashboard is only for managing the deployment.

## Why sign-in appeared to work but no profile was ever created

Worth writing down, because the symptom points nowhere near the cause: you sign
in, the session is real, and the app behaves as if you're a stranger. No error
in the browser.

`@convex-dev/better-auth` derives both the token issuer *and* the URL Convex
fetches signing keys from out of `CONVEX_SITE_URL`. On this deployment that
variable is the **dashboard** domain and ends in a slash, so Convex was asking

```
https://convexdash.hookedcue.com//api/auth/convex/jwks   -> 404
```

The dashboard doesn't serve HTTP actions — `cnx.hookedcue.com` does. So every
token minted correctly and then failed validation, `ctx.auth.getUserIdentity()`
came back empty, and `ensureProfile` ran as nobody. `convex/auth.config.ts` now
overrides just the fetch URL, using `BETTER_AUTH_URL`.

To check the whole chain without a browser: sign up a throwaway over
`/api/auth/sign-up/email`, exchange the session for a JWT at
`/api/auth/convex/token`, then call `auth:getCurrentUser` against
`/api/query` with that JWT. If the identity comes back, the chain is sound.

## Still to do by hand (as of 2026-08-13)

Three things that can't be done from this repo, in the order they matter.

### 1. The landing site's webhook pair

Until these are set, a signup on hookedcue.com is written to a local JSONL file
on the landing container instead of reaching the approval queue — so it looks
like it worked and nobody ever sees it.

Dokploy → organisation **Farman testing** → project **Farman-Personal** →
service **Landingpage** → Environment. Add, keeping the existing five lines:

```
BETA_WEBHOOK_URL=https://cnx.hookedcue.com/beta
BETA_WEBHOOK_SECRET=<the same value as BETA_INGEST_SECRET on Convex>
```

Save, then Deploy. Confirm with `node verify-access.mjs --secret <the secret>`,
which submits a real row and checks it lands in the queue.

### 2. Two headers that a static build can't set

`app.hookedcue.com` is a static bundle and the host ignores `public/_headers`.
The content policy now travels in a meta tag in `index.html`, which the browser
enforces identically — but two directives are header-only by spec and are still
missing in production:

- `Strict-Transport-Security: max-age=31536000`
- `Content-Security-Policy: frame-ancestors 'none'` (a frame-buster script in
  `index.html` stands in for it, which is weaker: it runs after the page loads)

Add them as a Cloudflare **Transform Rule → Modify Response Header** on
`app.hookedcue.com`. Check with `curl -sI https://app.hookedcue.com/`.

### 3. Credentials that have been pasted into a chat window

The Convex self-hosted admin key and `BETTER_AUTH_SECRET` should both be
rotated. Rotating the auth secret signs everyone out, which is fine — there are
few enough accounts for that not to matter yet, and it will matter later.
