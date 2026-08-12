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
# who gets the admin dashboard. replaces the old "first account ever becomes
# admin" rule, which on an empty production database handed the dashboard to
# whichever stranger signed up first.
npx convex env set ADMIN_EMAILS "you@example.com"

# shared secret for the landing site's /beta ingest route
npx convex env set BETA_INGEST_SECRET "<random 32 bytes>"
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
