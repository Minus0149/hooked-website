/**
 * Parser tests for the playlist paste box.
 * Run: node --experimental-strip-types verify-import.mjs
 *
 * The samples are the real headers the three common exporters emit — Exportify,
 * TuneMyMusic and Music.app — plus the ways people type a list by hand.
 */
import { parsePlaylist } from "./src/lib/playlist-parse.ts";

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n         got      ${a}\n         expected ${e}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------- Exportify
section("Exportify CSV (Spotify)");
{
  const csv = [
    '"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album Name","Duration (ms)"',
    '"spotify:track:11dFghVXANMlKmJXsNCbNl","Cut To The Feeling","spotify:artist:6sFIWsNpZYqfjUpaCgueju","Carly Rae Jepsen","Cut To The Feeling","207959"',
    '"spotify:track:4uLU6hMCjMI75M1A2tKUQC","Never Gonna Give You Up","spotify:artist:0gxyHStUsqpMadRV0Di1Qt","Rick Astley","Whenever You Need Somebody","213573"',
  ].join("\n");
  const r = parsePlaylist(csv);
  check("format", r.format, "csv");
  check("column pick", r.columns, {
    title: "track name",
    artist: "artist name(s)",
    album: "album name",
  });
  check("row count", r.rows.length, 2);
  check("first row", r.rows[0], {
    title: "Cut To The Feeling",
    artist: "Carly Rae Jepsen",
    album: "Cut To The Feeling",
    spotifyId: "11dFghVXANMlKmJXsNCbNl",
  });
}

// ------------------------------------------------------------- TuneMyMusic
section("TuneMyMusic CSV");
{
  const csv = [
    "Track name,Artist name,Album,Playlist name,Type,ISRC",
    "Bad Habit,Steve Lacy,Gemini Rights,My Mix,track,USSM12204340",
    "Kill Bill,SZA,SOS,My Mix,track,USRC12205069",
  ].join("\n");
  const r = parsePlaylist(csv);
  check("format", r.format, "csv");
  check("title column beats ISRC", r.columns.title, "track name");
  check("rows", r.rows.map((x) => `${x.artist} — ${x.title}`), [
    "Steve Lacy — Bad Habit",
    "SZA — Kill Bill",
  ]);
}

// -------------------------------------------------------------- Music.app
section("Music.app export (tab separated)");
{
  const tsv = [
    "Name\tArtist\tComposer\tAlbum\tGrouping\tTime",
    "Sunflower\tPost Malone\t\tHollywood's Bleeding\t\t158",
  ].join("\n");
  const r = parsePlaylist(tsv);
  check("format", r.format, "csv");
  check("tab delimiter", r.rows[0], {
    title: "Sunflower",
    artist: "Post Malone",
    album: "Hollywood's Bleeding",
    spotifyId: undefined,
  });
}

// ------------------------------------------------------- hand-typed lines
section("Plain lines");
{
  const text = [
    "Fred again.. - Delilah (pull me out of this)",
    "1. Tame Impala — The Less I Know The Better",
    "  - SZA – Snooze (3:22)",
    "Kill Bill by SZA",
    "not a song line",
    "",
  ].join("\n");
  const r = parsePlaylist(text);
  check("format", r.format, "lines");
  check("pairs", r.rows.map((x) => `${x.artist} | ${x.title}`), [
    "Fred again.. | Delilah (pull me out of this)",
    "Tame Impala | The Less I Know The Better",
    "SZA | Snooze",
    "SZA | Kill Bill",
  ]);
  check("junk skipped", r.skipped, 1);
}

section("Title-first flip");
{
  const r = parsePlaylist("Snooze - SZA", { titleFirst: true });
  check("swapped", r.rows[0], { title: "Snooze", artist: "SZA" });
}

section("Featured artists collapse to the first");
{
  const r = parsePlaylist("Drake feat. 21 Savage - Rich Flex");
  check("primary artist", r.rows[0].artist, "Drake");
}

section("Duplicates are dropped once");
{
  const r = parsePlaylist(["SZA - Kill Bill", "sza - kill bill"].join("\n"));
  check("rows", r.rows.length, 1);
  check("counted", r.duplicates, 1);
}

// ----------------------------------------------------------- link-only paste
section("Bare Spotify links can't be resolved");
{
  const r = parsePlaylist(
    [
      "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl?si=abc",
      "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
    ].join("\n"),
  );
  check("format", r.format, "spotify");
  check("no rows", r.rows.length, 0);
  check("counted for the warning", r.skipped, 2);
}

section("Empty input");
{
  const r = parsePlaylist("   \n\n  ");
  check("format", r.format, "empty");
}

console.log(
  `\n${checks - failures}/${checks} checks passed` + (failures ? ` — ${failures} FAILED` : ""),
);
process.exit(failures ? 1 : 0);
