# Self-hosted Convex deployment

The production app is configured for these domains:

- App: `https://app.hookedcue.com`
- Convex backend: `https://convex.hookedcue.com`
- Convex HTTP/auth site: `https://cnx.hookedcue.com`
- Convex dashboard: `https://convexdash.hookedcue.com`

The browser errors below mean the Convex functions and HTTP routes have not been deployed to the self-hosted backend yet:

- `Could not find public function for 'library:getLibrary'`
- `No 'Access-Control-Allow-Origin' header is present`
- `GET https://cnx.hookedcue.com/api/auth/get-session net::ERR_FAILED`

Deploy from `C:\Users\minus\hooked\web` with the self-hosted backend URL and the admin key from your Convex server:

```powershell
$env:CONVEX_SELF_HOSTED_URL = "https://convex.hookedcue.com"
$env:CONVEX_SELF_HOSTED_ADMIN_KEY = "<admin-key-from-your-convex-server>"

npx convex env set SITE_URL "https://app.hookedcue.com"
npx convex env set CONVEX_SITE_URL "https://cnx.hookedcue.com"
npx convex deploy
```

If the production database is empty after the deploy, import the seed tracks:

```powershell
npx convex import --table tracks tracks-seed.jsonl
```

Do not use `convexdash.hookedcue.com` as the app Convex URL or auth site URL. The dashboard is only for managing the deployment.
