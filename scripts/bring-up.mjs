/**
 * Bring a fresh Convex deployment up to a working hooked backend.
 *
 * Works against Convex Cloud or a self-hosted backend — the difference is only
 * which environment variables are set, so this makes the hosting decision
 * reversible rather than load-bearing.
 *
 *   Cloud:       npx convex dev   (once, to create and link the project)
 *                node scripts/bring-up.mjs
 *
 *   Self-hosted: CONVEX_SELF_HOSTED_URL=... CONVEX_SELF_HOSTED_ADMIN_KEY=... \
 *                node scripts/bring-up.mjs
 *
 * Steps, in order, each one checked before the next:
 *   1. push schema + functions
 *   2. set the environment variables the app can't run without
 *   3. import the catalogue built by scripts/build-catalog.mjs
 *   4. report what actually landed
 *
 * Safe to re-run. The import appends, so step 3 is skipped when the catalogue
 * is already there rather than doubling it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(web, "catalog-out");

const args = process.argv.slice(2);
const YES = args.includes("--yes");

const run = (cmd, extra = []) => {
  const out = execFileSync("npx", ["convex", ...cmd, ...extra], {
    cwd: web,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  return out.trim();
};

const step = (n, what) => console.log(`\n[${n}] ${what}`);

// The app refuses to work without these; better to fail here with a name than
// at runtime with a decrypt error.
const REQUIRED_ENV = {
  ADMIN_EMAILS: "minus4399@gmail.com",
  SITE_URL: "https://app.hookedcue.com",
};

async function main() {
  const selfHosted = !!process.env.CONVEX_SELF_HOSTED_URL;
  console.log(
    selfHosted
      ? `target: self-hosted at ${process.env.CONVEX_SELF_HOSTED_URL}`
      : "target: Convex Cloud (from .env.local / CONVEX_DEPLOYMENT)",
  );

  if (!existsSync(join(OUT, "tracks.jsonl"))) {
    console.error(
      `\nNo catalogue at ${OUT}.\nRun: node scripts/build-catalog.mjs --limit 1000`,
    );
    process.exit(1);
  }

  if (!YES) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ok = await rl.question("\nPush functions and import the catalogue? [y/N] ");
    rl.close();
    if (ok.trim().toLowerCase() !== "y") {
      console.log("nothing done");
      return;
    }
  }

  step(1, "pushing schema and functions");
  run(["deploy", "-y"]);
  console.log("    ok");

  step(2, "setting environment variables");
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    let current = "";
    try {
      current = run(["env", "get", key]);
    } catch {
      current = "";
    }
    if (current === value) {
      console.log(`    ${key} already correct`);
    } else {
      run(["env", "set", key, value]);
      console.log(`    ${key} set`);
    }
  }
  console.log(
    "    NOTE: BETTER_AUTH_SECRET and BETA_INGEST_SECRET are secrets and are not\n" +
      "          set here. Generate and set them yourself:\n" +
      '            npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"',
  );

  step(3, "importing the catalogue");
  const tracks = readFileSync(join(OUT, "tracks.jsonl"), "utf8").trim().split("\n");
  const hooks = readFileSync(join(OUT, "hooks.jsonl"), "utf8").trim().split("\n");
  console.log(`    ${tracks.length} tracks, ${hooks.length} hooks to load`);

  let existing = 0;
  try {
    existing = run(["data", "tracks", "--limit", "1"]).split("\n").length - 2;
  } catch {
    existing = 0;
  }
  if (existing > 0) {
    console.log("    tracks already present — skipping (import appends, it does not merge)");
  } else {
    run(["import", "--table", "tracks", "--append", "-y", join(OUT, "tracks.jsonl")]);
    run(["import", "--table", "hooks", "--append", "-y", join(OUT, "hooks.jsonl")]);
    console.log("    imported");
  }

  step(4, "checking what landed");
  for (const table of ["tracks", "hooks", "profiles"]) {
    try {
      const rows = run(["data", table, "--limit", "5"]).split("\n").length - 2;
      console.log(`    ${table.padEnd(9)} ${rows > 0 ? "has rows" : "empty"}`);
    } catch (e) {
      console.log(`    ${table.padEnd(9)} could not read (${String(e).slice(0, 60)})`);
    }
  }

  console.log(`
Done. What still needs a human:
  - sign in once so ensureProfile creates your admin profile
  - set BETTER_AUTH_SECRET and BETA_INGEST_SECRET (see above)
  - point the three surfaces at this deployment:
      web/.env.local          VITE_CONVEX_URL, VITE_CONVEX_SITE_URL
      mobile/.env             EXPO_PUBLIC_CONVEX_URL, EXPO_PUBLIC_CONVEX_SITE_URL
      landing (Dokploy env)   BETA_WEBHOOK_URL
`);
}

await main();
