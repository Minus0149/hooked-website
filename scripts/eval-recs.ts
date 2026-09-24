/**
 * Run the holdout test (scripts/lib/evaluate.ts) against a deployment's real
 * swipes and print how each ranker does against a shuffle.
 *
 *   npx tsx scripts/eval-recs.ts            # the dev deployment in .env.local
 *   npx tsx scripts/eval-recs.ts --prod     # production
 *   npx tsx scripts/eval-recs.ts --swipes file.jsonl --label "seeded listeners"
 *   … --store                               # also show it on the admin dashboard
 *
 * Reads with `npx convex data`, so it needs the CLI's login, not a key.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { evaluate, type Swipe } from "./lib/evaluate";
import type { SwipeAction, Track } from "../src/types";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(`--${f}`);
const val = (f: string) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = has("prod") ? ["--prod"] : [];

function convex(cmd: string[], input?: string): string {
  return execFileSync("npx", ["convex", ...cmd], {
    encoding: "utf8",
    maxBuffer: 512e6,
    shell: process.platform === "win32",
    input,
    stdio: [input ? "pipe" : "ignore", "pipe", "ignore"],
  });
}
const jsonl = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));

// the CLI caps a read; past this, switch to `npx convex export`
const CAP = 8000;
const rawTracks = jsonl(convex(["data", ...target, "tracks", "--limit", String(CAP), "--format", "jsonl"]));
const catalog: Track[] = rawTracks.map((t) => ({
  id: t.trackId, title: t.title, artist: t.artist, album: t.album ?? "", artwork: t.artwork ?? "",
  previewUrl: t.previewUrl ?? "", durationMs: t.durationMs ?? 30000, genre: t.genre ?? "",
  accent: t.accent ?? "#fff", markets: t.markets, heat: t.heat, energy: t.energy,
  sound: t.sound, audioMood: t.audioMood, vocal: t.vocal,
}));

const file = val("swipes");
const rawSwipes = file
  ? jsonl(readFileSync(file, "utf8"))
  : jsonl(convex(["data", ...target, "swipes", "--limit", String(CAP), "--format", "jsonl"]));
if (!file && rawSwipes.length >= CAP) {
  console.warn(`read the newest ${CAP} swipes only — use \`npx convex export\` + --swipes for the full log`);
}
const swipes: Swipe[] = rawSwipes.map((s, i) => ({
  userId: String(s.userId),
  trackId: String(s.trackId),
  action: s.action as SwipeAction,
  t: typeof s._creationTime === "number" ? s._creationTime : i,
}));

const report = evaluate(swipes, catalog);
const label = val("label") ?? (file ? `file ${file}` : has("prod") ? "production swipes" : "dev swipes");
const heard = catalog.filter((t) => t.sound).length;

console.log(`\n${label}: ${report.users} listeners, ${report.examSwipes} exam swipes`);
console.log(`catalogue: ${catalog.length} tracks, ${heard} with a sound profile\n`);
for (const r of report.rankers) {
  const bar = "█".repeat(Math.round((r.auc - 0.3) * 50));
  console.log(`  ${r.name.padEnd(22)} AUC ${r.auc.toFixed(3)}  ${bar}`);
}
console.log("\n  0.5 = a coin flip (a shuffle).");

if (has("store")) {
  const payload = JSON.stringify({ report: { ...report, label, heard, catalog: catalog.length } });
  convex(["run", ...target, "admin:storeEval", payload]);
  console.log("stored — the admin Analytics tab shows it");
}
