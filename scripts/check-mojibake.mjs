/**
 * CI guard: fails if any source file contains double-encoded UTF-8
 * ("â€º"-style mojibake). Exists because scripted edits have corrupted
 * characters here more than once — this makes that class of bug unshippable.
 *
 * Usage: node scripts/check-mojibake.mjs [rootDirs...]
 */
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["src", "convex", "App.tsx", "index.html"];
const EXT_OK = new Set([".ts", ".tsx", ".css", ".html", ".json", ".mjs", ".js", ".svg", ".txt", ".xml", ".webmanifest"]);

// an accented-latin leader followed by continuation-range or cp1252-punctuation
// characters — the signature of UTF-8 that was decoded as Windows-1252
const SUSPECT =
  /[\u00C0-\u00FF](?:[\u0080-\u00FF]|[\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018-\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178])+/g;

let bad = 0;
const stack = [...ROOTS];
while (stack.length) {
  const cur = stack.pop();
  let st;
  try {
    st = statSync(cur);
  } catch {
    continue;
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(cur)) {
      if (entry === "node_modules" || entry === ".next" || entry === "android") continue;
      stack.push(join(cur, entry));
    }
    continue;
  }
  if (!EXT_OK.has(extname(cur))) continue;
  let text;
  try {
    text = await import("node:fs").then((fs) => fs.readFileSync(cur, "utf8"));
  } catch {
    continue;
  }
  const hits = text.match(SUSPECT);
  if (hits) {
    bad++;
    console.error(`✗ ${cur}: ${hits.length} suspect run(s), e.g. ${JSON.stringify(hits[0])}`);
  }
}

if (bad > 0) {
  console.error(`\n${bad} file(s) contain double-encoded characters. Run the repair script, fix the source, do not ship.`);
  process.exit(1);
}
console.log("mojibake check: clean");
