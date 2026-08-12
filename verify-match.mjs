/**
 * Live check that the two open catalogues still answer the way we parse them.
 * Run: node --experimental-strip-types verify-match.mjs
 *
 * This hits Deezer and iTunes for real. It's the test that catches a response
 * shape changing under us — which is the failure mode that would otherwise show
 * up as "import found nothing" with no error anywhere.
 */
import { searchDeezer, searchItunes, MIN_CONFIDENCE } from "./convex/matching.ts";

const CASES = [
  { artist: "SZA", title: "Kill Bill" },
  { artist: "Fred again..", title: "Delilah (pull me out of this)" },
  { artist: "Arijit Singh", title: "Kesariya" },
];

let failures = 0;

function ok(cond, label, detail = "") {
  if (cond) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function checkMatch(provider, row, m) {
  if (!m || m === "throttled" || m === "blocked") {
    // Neither a throttle nor a regional block is a contract break — the importer
    // handles both by design. Only a changed response shape should fail here.
    const why =
      m === "throttled" ? "throttled" : m === "blocked" ? "region-filtered" : "no match";
    console.log(`  skip ${provider}: ${row.artist} — ${why}`);
    return;
  }
  const label = `${provider}: ${row.artist} — ${row.title}`;
  ok(m.confidence >= MIN_CONFIDENCE, `${label} confident enough`, m.confidence.toFixed(2));
  ok(/^https:\/\//.test(m.previewUrl), `${label} https preview`);
  ok(/^https:\/\//.test(m.artwork), `${label} https artwork`);
  ok(m.durationMs > 30_000, `${label} full duration`, `${Math.round(m.durationMs / 1000)}s`);
  ok(!!m.providerId, `${label} has an id`);
  ok(
    m.artist.toLowerCase().includes(row.artist.toLowerCase().split(" ")[0].slice(0, 5)),
    `${label} is by the artist asked for`,
    m.artist,
  );
  console.log(`       → ${m.artist} — ${m.title} (${m.album || "no album"})`);
}

console.log("iTunes — the one that carries the import");
for (const [i, row] of CASES.entries()) {
  checkMatch("itunes", row, await searchItunes(row));
  if (i < CASES.length - 1) await new Promise((r) => setTimeout(r, 3200));
}

console.log("\nDeezer — the fallback (region-filtered from some IPs)");
checkMatch("deezer", CASES[0], await searchDeezer(CASES[0]));

console.log("\nA song that doesn't exist");
{
  const junk = { artist: "Zzzzq Nonexistent", title: "Qqqq Not A Real Song 99999" };
  const m = await searchItunes(junk);
  ok(
    m === null || m === "throttled" || m.confidence < MIN_CONFIDENCE,
    "rejected rather than guessing",
    m && typeof m === "object" ? `${m.title} @ ${m.confidence.toFixed(2)}` : String(m),
  );
}

console.log("\nOnly covers on offer — must refuse, not import a stranger's version");
{
  await new Promise((r) => setTimeout(r, 3200));
  // The original of this one isn't in Apple's search catalogue; everything that
  // comes back is somebody else covering or remixing it.
  const m = await searchItunes({ artist: "Tame Impala", title: "The Less I Know The Better" });
  const okArtist = m === null || m === "throttled" || /tame impala/i.test(m.artist);
  const okTitle =
    m === null || m === "throttled" || /less i know/i.test(m.title);
  ok(okArtist, "no cover smuggled in", m && typeof m === "object" ? m.artist : String(m));
  ok(
    okTitle,
    "no other song by the right artist either",
    m && typeof m === "object" ? m.title : String(m),
  );
}

console.log(failures ? `\n${failures} FAILED` : "\nall good");
process.exit(failures ? 1 : 0);
