# The catalogue: a versioned file, not a reactive query

## Why it changed

Every client subscribed to `tracks.list`. Its result — 2,573 tracks with their
hooks — was **2,086 KB** and arrived as the first message on the websocket, on
every start, warm or cold (measured on app.hookedcue.com, 2026-09-26). When that
message stalled, everything queued behind it on the same socket waited: the
admin button took 40 s to appear, a song report sat on "Sending…" for 2 minutes.
It also spent Convex bandwidth on every single app open.

The stall is on the network path, not the query. Downloading a finished 615 KB
file from the backend host, four times in a row: 1.9 s, **56 s**, 1.9 s, **50 s**.
Fetched as parallel parts, individual requests sometimes hung for 83–354 s while
the others arrived in under 1.5 s. A 424 KB file from Cloudflare took 0.9 s.

## How it works now

- **Server** (`convex/catalog.ts`). Any write that changes what clients see —
  a chart pull, an analyser ingest (energy, sound, hooks), a hook re-rank, a
  heat change, a creator publishing, hiding or editing hooks, an admin or report
  hide, a creator's account deletion — calls `touchCatalog()`. That bumps a
  counter and schedules **one** rebuild 20 s later, so a burst of writes (an
  analyser batch) is one build, not hundreds. The rebuild reads the catalogue
  once, encodes it (`src/lib/catalogCodec.ts`), splits it into parts of 400
  tracks, stores each part as a file, and only then advances `version`. Writes
  that land while a build is reading trigger another build.
- **HTTP** (`GET /catalog?v=N&part=i` in `convex/http.ts`). Serves a part.
  `?v=<current>` is `Cache-Control: public, max-age=31536000, immutable` — a new
  catalogue is a new version and new URLs. The HTTP layer gzips on its own
  (the action runtime has no `CompressionStream`, so the files are stored plain).
- **Clients** (`src/lib/useCatalog.ts`, web and mobile). Subscribe to
  `catalog:version` — `{ v, parts }`, a few bytes — and download the parts in
  parallel only when that version isn't already stored: IndexedDB on the web,
  one AsyncStorage key per part on the phone (Android refuses a single ~2 MB
  row). Each part request times out and retries (5 → 8 → 12 → 20 → 30 s), so a
  stalled request is abandoned instead of waited on. Parts from two versions
  are never spliced together. The bundled catalogue is still the first paint.
- `tracks.list` stays for app builds that predate this, until they update.

Why HTTP parts rather than a one-shot `convex.query`: a query rides the same
websocket (head-of-line blocking again) and can't be browser-cached; one big
HTTP file stalls as a whole; small parallel parts with retries recover.

## The format (catalogCodec.ts)

Each track is a tuple instead of an object with repeated keys; Apple's fixed
URL prefixes become `~` (and the artwork's `/600x600bb.jpg` suffix is dropped
and restored exactly — `lib/art.ts` resizes from it); hooks are
`[id, startMs, durationMs, label?]`; trailing empty fields are dropped. Every
transformation round-trips byte for byte (`tests/catalog-codec.test.ts`).

## Numbers (2,573 tracks, live data)

| | before (`tracks.list`) | after |
|---|---|---|
| Payload, raw | 2,214 KB | 1,254 KB (7 parts) |
| Payload, gzip | 628 KB | ~600 KB (561 KB measured in Edge) |
| Transferred on a **warm** start | 2,086 KB over the websocket, every time | **0** — no catalogue request at all |
| Transferred on a cold start | 2,086 KB, one message | 561 KB gzip in 7 parallel requests |
| Largest websocket message | 2,086.6 KB | 6.1 KB |
| Parts, clean network (Edge) | — | all 7 in 1.2–1.6 s |
| Parts, with stalled requests (Edge) | whole socket waits (50 s – minutes) | retries recover: 6.4 s and 9.8 s worst seen |
| First card on screen | 0.2–0.7 s (bundled) | 0.3–0.4 s (bundled, or cached server catalogue) |

gzip barely shrinks further because what's left is high-entropy: random hook
ids, sound vectors, URL hashes. The real saving is not sending it at all on a
warm start, and not letting it block the socket on a cold one.

## Operating it

- `npx convex run catalog:info` — version, parts, bytes, when built, whether a
  rebuild is pending.
- `npx convex run catalog:rebuild` — build now (safe any time).
- A new catalogue appears to clients ~20 s after the change plus the download.

## What goes in it (catalogRules.ts, curation.ts)

Measured on prod on 2026-09-27, before this: 3,076 songs, 7% Indian, 340 US
country songs (141 of them charted "in India" because the pull read India's
*Western* genre charts), 31 karaoke/sped-up/cover versions, one artist of
bass-boosted edits with 38 songs, and 53% released more than five years ago.
A Hindi + Punjabi listener's first 50 cards had one Hindi or Punjabi song.

- **Sources** (`FEEDS`, 32 feeds, all checked by hand): India's most-played and
  top songs, then its own genre charts (Bollywood, Indian Pop, Punjabi, Tamil,
  Telugu, Regional Indian, Malayalam, Kannada, Marathi, Bengali, Indian Folk,
  Sufi & Ghazals, Hip-Hop); US/UK most-played and top songs plus a few big US
  genres; one small US country feed for listeners who opt in; UAE, Saudi,
  Korea and Brazil top songs. Devotional is left out. Apple has no public
  new-releases song feed (`/new-releases` 404s on the v2 API, 400 on the legacy
  one), so freshness is the charts themselves plus the stale rule below.
- **Language** (`langOf`, stored as `tracks.lang`, sent at codec index 17):
  script, then genre, then romanised Hindi/Punjabi words, then the artist's
  other songs, then the storefronts it charts in. "in" = Indian, language
  unknown.
- **Chart clock**: every pull stamps `chartedAt` (and `headlineAt` for a main
  chart) on each song it sees, new or not.
- **Curation** (daily, 05:53 UTC, or "Curate the catalogue now" in Config):
  hides filler/covers/variants/devotional, songs off every chart for
  `staleWeeks`, songs older than `maxAgeYears` not seen on a chart in
  `oldChartDays`, and each artist past their `artistCap` strongest. It only
  hides (`hiddenBy: "curation"`, `hiddenReason`), un-hides its own hides when
  the reason goes, and never touches an admin's hide, an admin's un-hide
  (`keep`), an artist upload or an import. Saved songs stay in libraries.
- **The deck** (`src/data/ranking.ts` `mixDeck`, both clients): US country goes
  to the back unless the listener picked country or right-swiped one; a
  listener with no language picked gets `indiaSharePct` (60) Indian; one who
  picked gets `pickedLangPct` (80) in their languages, the rest discovery.
- **Measuring**: `npx tsx scripts/catalog-audit.ts --out audit.md` — the live
  catalogue's composition and the first 50 cards for three onboarding answers.
- **One-offs**: `npx convex run curation:backfill` (languages + release dates),
  `npx convex run charts:refresh '{"all":true}'` (every feed at once).
