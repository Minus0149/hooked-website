/**
 * Does answering the onboarding questions actually change the deck?
 * Run: node --experimental-strip-types verify-taste.mjs
 *
 * Two things matter and they pull against each other: matches have to surface
 * early, and nothing may be locked out. A taste profile that filtered instead
 * of tilting would turn the app into a playlist someone else wrote.
 */
import { readFileSync } from "node:fs";
import {
  availableTasteOptions,
  tasteScore,
  EMPTY_TASTE,
  LANGUAGES,
  GENRES,
} from "./src/data/taste.ts";

const tracks = readFileSync("./catalog-out/tracks.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (name) => console.log(`\n${name}`);

// mirrors tasteSort in src/state/store.tsx
function tasteSort(list, taste, seed = 1) {
  let n = seed;
  const rand = () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648;
  const shuffled = [...list].sort(() => rand() - 0.5);
  return shuffled
    .map((t, i) => ({ t, key: i - tasteScore(t, taste) * 12 }))
    .sort((a, b) => a.key - b.key)
    .map((s) => s.t);
}

console.log(`catalogue: ${tracks.length} tracks`);

section("Hindi + hip-hop");
{
  const taste = { languages: ["hi"], genres: ["hiphop"], adventure: "mixed" };
  const deck = tasteSort(tracks, taste);
  const hits = deck.slice(0, 20).filter((t) => tasteScore(t, taste) > 0).length;
  const baseline = tracks.filter((t) => tasteScore(t, taste) > 0).length / tracks.length;
  check(
    "matches concentrate at the top",
    hits / 20 > baseline * 1.5,
    `${hits}/20 up front vs ${(baseline * 100).toFixed(0)}% of the catalogue`,
  );
  check("nothing is excluded", deck.length === tracks.length, `${deck.length} still dealt`);
  const outsider = deck.findIndex((t) => tasteScore(t, taste) === 0);
  check(
    "something outside the profile still appears early",
    outsider >= 0 && outsider < 60,
    `first at position ${outsider + 1}`,
  );
}

section("Arabic only");
{
  const taste = { languages: ["ar"], genres: [], adventure: "mixed" };
  const deck = tasteSort(tracks, taste);
  const hits = deck.slice(0, 20).filter((t) => tasteScore(t, taste) > 0).length;
  check("Gulf charts surface", hits >= 8, `${hits}/20 up front`);
}

section("No answers at all");
{
  const deck = tasteSort(tracks, EMPTY_TASTE);
  check("still a full deck", deck.length === tracks.length);
  check(
    "nothing is favoured",
    deck.filter((t) => tasteScore(t, EMPTY_TASTE) > 0).length === 0,
  );
}

section("The questions only offer what this catalogue can play");
{
  const offered = availableTasteOptions(tracks);
  const dead = (list, key) =>
    list
      .filter((o) => !tracks.some((t) => tasteScore(t, { ...EMPTY_TASTE, [key]: [o.id] }) > 0))
      .map((o) => o.label);

  // an option shown but unmatchable is a promise the deck can't keep
  const dl = dead(offered.languages, "languages");
  const dg = dead(offered.genres, "genres");
  check("every language offered matches something", dl.length === 0, dl.join(", ") || "all match");
  check("every genre offered matches something", dg.length === 0, dg.join(", ") || "all match");
  check(
    "the unplayable ones were dropped",
    offered.languages.length < LANGUAGES.length || offered.genres.length < GENRES.length,
    `${offered.languages.length}/${LANGUAGES.length} languages, ${offered.genres.length}/${GENRES.length} genres offered`,
  );
}

section("A cold start still gets a real menu");
{
  // the bundled catalogue carries no market tags at all
  const baked = tracks.slice(0, 118).map((t) => ({ genre: t.genre }));
  const offered = availableTasteOptions(baked);
  check(
    "falls back to the full list rather than a menu of two",
    offered.languages.length === LANGUAGES.length,
    `${offered.languages.length} languages offered`,
  );
}

console.log(failures ? `\n${failures} FAILED` : "\nall good");
process.exit(failures ? 1 : 0);
