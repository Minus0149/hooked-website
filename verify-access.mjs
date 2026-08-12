/**
 * Post-deploy smoke test for the invite-only flow.
 *
 *   node verify-access.mjs
 *   node verify-access.mjs --secret "<BETA_INGEST_SECRET>"
 *
 * Checks the things that are actually observable from outside: the Convex
 * backend is up, the auth routes are deployed, the /beta ingest route exists
 * and rejects an unauthenticated call, and the landing form still validates.
 * With --secret it also proves a real submission lands in the queue.
 */
const CONVEX = "https://convex.hookedcue.com";
const CNX = "https://cnx.hookedcue.com";
const LANDING = "https://hookedcue.com";
const APP = "https://app.hookedcue.com";

const secretArg = process.argv.indexOf("--secret");
const SECRET = secretArg > -1 ? process.argv[secretArg + 1] : null;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const status = async (url, init) => {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    return res.status;
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : err}`;
  }
};

console.log("\nconvex backend");
check("backend responds", (await status(`${CONVEX}/version`)) === 200);
check("auth routes deployed (jwks)", (await status(`${CNX}/api/auth/convex/jwks`)) === 200);

console.log("\n/beta ingest route");
const noSecret = await status(`${CNX}/beta`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
check(
  "route exists and is deployed",
  noSecret !== 404,
  noSecret === 404 ? "still 404 — convex deploy hasn't run" : `status ${noSecret}`,
);
check(
  "rejects a call with no secret",
  noSecret === 403,
  noSecret === 403 ? "" : `expected 403, got ${noSecret}`,
);

if (SECRET) {
  const email = `verify+${Date.now()}@example.com`;
  const res = await fetch(`${CNX}/beta`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-beta-secret": SECRET },
    body: JSON.stringify({ name: "verify script", email, device: "pixel 8a" }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  check("accepts a submission with the secret", res.status === 200 && body.ok === true, email);
  const again = await fetch(`${CNX}/beta`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-beta-secret": SECRET },
    body: JSON.stringify({ name: "verify script", email, device: "pixel 8a" }),
    signal: AbortSignal.timeout(20_000),
  });
  const againBody = await again.json().catch(() => ({}));
  check("a repeat submission is a no-op duplicate", againBody.duplicate === true);
  console.log(`\n  → approve or delete ${email} in the Requests tab when you're done.`);
} else {
  console.log("  ..  skipped the authenticated write (pass --secret to include it)");
}

console.log("\nsurfaces");
check("landing /beta page", (await status(`${LANDING}/beta`)) === 200);
check("app loads", (await status(`${APP}/`)) === 200);
check(
  "landing api still validates",
  (await status(`${LANDING}/api/beta`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })) === 400,
);

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
