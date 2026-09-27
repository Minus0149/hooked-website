/**
 * What the deck is made of, and what it deals first — measured, not guessed.
 *
 *   npx tsx scripts/catalog-audit.ts --live --out audit.md
 *   npx tsx scripts/catalog-audit.ts --catalog saved.json --src path/to/old/checkout --out before.md
 *
 * Reads the published catalogue file (the same parts every client downloads,
 * so hidden songs are already out), or a saved copy of it. Reports composition
 * by region, language, genre and release decade plus the top artists, then
 * deals the first 50 cards for three onboarding answers with the clients' own
 * ranking code (src/data/ranking.ts — or an older checkout's, via --src, to
 * compare before and after) under a seeded shuffle, so a run is repeatable.
 *
 * Release dates aren't in the catalogue file; they come from Apple's lookup
 * and are cached (--dates, default .tmp/release-dates.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodePart, type CatalogTrack } from "../src/lib/catalogCodec";
import { artistLanguages, fillerReason, isIndianLang, langOf, leadArtist } from "../convex/catalogRules";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const SITE = "https://shocking-goldfinch-745.convex.site";
const CLOUD = "https://shocking-goldfinch-745.convex.cloud";

async function liveCatalog(): Promise<CatalogTrack[]> {
  const res = await fetch(`${CLOUD}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "catalog:version", args: {}, format: "json" }),
  });
  const { v, parts } = ((await res.json()) as { value: { v: number; parts: number } }).value;
  const tracks: CatalogTrack[] = [];
  for (let i = 0; i < parts; i++) {
    const doc = await (await fetch(`${SITE}/catalog?v=${v}&part=${i}`)).json();
    tracks.push(...(decodePart(doc)?.tracks ?? []));
  }
  console.error(`live catalogue v${v}: ${parts} parts, ${tracks.length} tracks`);
  return tracks;
}

async function releaseDates(ids: string[], cachePath: string): Promise<Map<string, string>> {
  const cache: Record<string, string> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const missing = ids.filter((id) => /^\d+$/.test(id) && !(id in cache));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${batch.join(",")}&entity=song`);
      const json = (await res.json()) as { results?: { trackId?: number; releaseDate?: string }[] };
      for (const id of batch) cache[id] = "";
      for (const r of json.results ?? []) if (r.trackId && r.releaseDate) cache[String(r.trackId)] = r.releaseDate.slice(0, 10);
    } catch {
      /* a lost batch shows up as "unknown" */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache));
  return new Map(Object.entries(cache));
}

// mulberry32: a seeded Math.random, so the simulated decks are repeatable
function seed(n: number) {
  let a = n >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (n: number, of: number) => `${of ? Math.round((n / of) * 100) : 0}%`;
const count = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const catalogPath = arg("catalog");
const tracks: CatalogTrack[] = catalogPath ? JSON.parse(readFileSync(catalogPath, "utf8")) : await liveCatalog();
if (arg("save")) writeFileSync(arg("save")!, JSON.stringify(tracks));
// the server's tag when there is one; otherwise the same inference it would make
const byArtist = artistLanguages(tracks);
const lang = (t: CatalogTrack) => t.lang || langOf(t, byArtist);
const dates = await releaseDates(
  tracks.map((t) => t.trackId),
  resolve(arg("dates") ?? ".tmp/release-dates.json"),
);
const decade = (t: CatalogTrack) => {
  const d = dates.get(t.trackId);
  return d ? `${d.slice(0, 3)}0s` : "unknown";
};
const year = (t: CatalogTrack) => Number((dates.get(t.trackId) ?? "").slice(0, 4)) || null;

const out: string[] = [];
const table = (title: string, rows: [string, number][], total: number, limit = 12) => {
  out.push(`\n**${title}**\n`, "| | songs | share |", "|---|---:|---:|");
  for (const [k, n] of rows.slice(0, limit)) out.push(`| ${k || "(none)"} | ${n} | ${pct(n, total)} |`);
};

const N = tracks.length;
const indian = tracks.filter((t) => isIndianLang(lang(t))).length;
out.push(`# Catalogue audit — ${new Date().toISOString().slice(0, 10)}`, "");
out.push(`${N} dealable songs. Indian ${indian} (${pct(indian, N)}), global ${N - indian} (${pct(N - indian, N)}).`);
const country = tracks.filter((t) => /country/.test(t.genre.toLowerCase()) && !isIndianLang(lang(t))).length;
const filler = tracks.filter((t) => fillerReason(t)).length;
const recent = tracks.filter((t) => (year(t) ?? 0) >= new Date().getFullYear() - 5).length;
out.push(`US-style country ${country} (${pct(country, N)}); filler/covers/variants ${filler}; released in the last 5 years ${recent} (${pct(recent, N)}).`);
table("Language", count(tracks, lang), N);
table("Genre", count(tracks, (t) => t.genre.toLowerCase()), N, 15);
table("Release decade", count(tracks, decade), N);
table("Top artists (lead credit)", count(tracks, (t) => leadArtist(t.artist)), N, 10);

// ---------------------------------------------------------------- decks
const src = resolve(arg("src") ?? ".");
const ranking = await import(pathToFileURL(`${src}/src/data/ranking.ts`).href);
const taste = await import(pathToFileURL(`${src}/src/data/taste.ts`).href);
const asTrack = (t: CatalogTrack) => ({
  id: t.trackId,
  title: t.title,
  artist: t.artist,
  album: t.album,
  artwork: t.artwork,
  previewUrl: t.previewUrl,
  durationMs: t.durationMs,
  genre: t.genre,
  accent: t.accent,
  hooks: t.hooks,
  markets: t.markets,
  heat: t.heat,
  energy: t.energy,
  sound: t.sound,
  audioMood: t.audioMood,
  vocal: t.vocal,
  lang: t.lang,
});
const deckOf = tracks.map(asTrack);
const PROFILES = [
  { name: "Hindi + Punjabi", taste: { languages: ["hi", "pa"], genres: [], adventure: "mixed" } },
  { name: "English pop", taste: { languages: ["en"], genres: ["pop"], adventure: "mixed" } },
  { name: "Just the hits", taste: { languages: [], genres: [], adventure: "hits" } },
];
const byId = new Map(tracks.map((t) => [t.trackId, t]));
out.push("\n## First 50 cards per onboarding answer\n");
for (const p of PROFILES) {
  seed(20260927);
  const steer = { ...ranking.NO_STEER, taste: { ...taste.EMPTY_TASTE, ...p.taste }, mix: ranking.DEFAULT_MIX };
  const queue = ranking.spreadAlbums(ranking.buildQueue(deckOf, new Set(), [], steer)).slice(0, 50);
  const cards = queue.map((q: { id: string }) => byId.get(q.id)!);
  const ind = cards.filter((t: CatalogTrack) => isIndianLang(lang(t))).length;
  const picked = p.taste.languages.length
    ? cards.filter((t: CatalogTrack) => p.taste.languages.includes(lang(t))).length
    : null;
  const artists = new Set(cards.map((t: CatalogTrack) => leadArtist(t.artist))).size;
  const ctry = cards.filter((t: CatalogTrack) => /country/.test(t.genre.toLowerCase()) && !isIndianLang(lang(t))).length;
  const langs = count(cards, lang).map(([k, n]) => `${k || "?"} ${n}`).join(", ");
  out.push(`\n### ${p.name}\n`);
  out.push(
    `Indian ${ind}/50${picked !== null ? `, in a picked language ${picked}/50` : ""}, US country ${ctry}, ${artists} different artists. Languages: ${langs}.\n`,
  );
  out.push("| # | song | artist | genre | lang | year |", "|---:|---|---|---|---|---|");
  cards.forEach((t: CatalogTrack, i: number) =>
    out.push(`| ${i + 1} | ${t.title.replace(/\|/g, "/")} | ${t.artist.replace(/\|/g, "/")} | ${t.genre} | ${lang(t) || "?"} | ${year(t) ?? ""} |`),
  );
}

const text = out.join("\n") + "\n";
if (arg("out")) writeFileSync(arg("out")!, text);
else console.log(text);
console.error(`Indian ${pct(indian, N)} of ${N}; decks written${arg("out") ? ` to ${arg("out")}` : ""}`);
