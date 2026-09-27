import { describe, expect, it } from "vitest";
import {
  FEEDS,
  artistLanguages,
  curate,
  fillerReason,
  isIndianLang,
  langOf,
  leadArtist,
  strongLang,
  type CurationTrack,
} from "../convex/catalogRules";

/**
 * What the catalogue is made of. Measured on prod before this existed: 141
 * US-country songs charted "in India" (the old pull read India's Western genre
 * charts), Bollywood and Punjabi arrived as "worldwide" with nothing to tell
 * them apart, and one artist of bass-boosted edits had 38 songs in the deck.
 */

describe("sources", () => {
  it("leads with India's own charts and pulls country only once, small, from the US", () => {
    expect(FEEDS[0].country).toBe("in");
    const india = FEEDS.filter((f) => f.country === "in");
    expect(india.length).toBeGreaterThanOrEqual(FEEDS.length / 2 - 2);
    const country = FEEDS.filter((f) => /genre=6\//.test(f.url));
    expect(country.map((f) => f.id)).toEqual(["us:country"]);
    expect(country[0].url).toContain("limit=50");
  });

  it("never reads India's Western genre sub-charts", () => {
    for (const f of FEEDS.filter((f) => f.country === "in")) {
      expect(f.url).not.toMatch(/genre=(6|14|21|17|20|15|7|19)\//);
    }
  });

  it("leaves the devotional chart out", () => {
    expect(FEEDS.some((f) => /genre=1267\//.test(f.url))).toBe(false);
  });

  it("marks each storefront's main chart as a headline", () => {
    for (const f of FEEDS) {
      const main = f.v2 || !/genre=/.test(f.url);
      expect(f.headline).toBe(main);
    }
  });
});

describe("langOf", () => {
  const t = (over: Partial<{ title: string; artist: string; genre: string; markets: string[] }>) => ({
    title: "Song",
    artist: "Someone",
    genre: "pop",
    markets: [] as string[],
    ...over,
  });

  it("reads the script first", () => {
    expect(langOf(t({ title: "तेरे बिना" }))).toBe("hi");
    expect(langOf(t({ artist: "ਦਿਲਜੀਤ" }))).toBe("pa");
    expect(langOf(t({ title: "காதல்" }))).toBe("ta");
    expect(langOf(t({ title: "ప్రేమ" }))).toBe("te");
    expect(langOf(t({ title: "사랑", markets: ["us"] }))).toBe("ko");
    expect(langOf(t({ title: "حبيبي", markets: ["us"] }))).toBe("ar");
  });

  it("then the genre", () => {
    expect(langOf(t({ genre: "bollywood", markets: ["in"] }))).toBe("hi");
    expect(langOf(t({ genre: "indian pop" }))).toBe("hi");
    expect(langOf(t({ genre: "punjabi pop" }))).toBe("pa");
    expect(langOf(t({ genre: "tamil" }))).toBe("ta");
    expect(langOf(t({ genre: "telugu" }))).toBe("te");
    expect(langOf(t({ genre: "malayalam" }))).toBe("ml");
    expect(langOf(t({ genre: "regional indian" }))).toBe("in");
    expect(langOf(t({ genre: "k-pop" }))).toBe("ko");
    expect(langOf(t({ genre: "latin", markets: ["us"] }))).toBe("es");
  });

  it("reads 'worldwide' charting only in India as Indian", () => {
    expect(langOf(t({ genre: "worldwide", markets: ["in"] }))).toBe("in");
    expect(langOf(t({ genre: "worldwide", markets: ["in", "ae"] }))).toBe("in");
  });

  it("but a worldwide song that also charts in the US or UK as English", () => {
    expect(langOf(t({ genre: "worldwide", markets: ["in", "us"] }))).toBe("en");
  });

  it("calls a Western-charting pop song English, and admits when it can't tell", () => {
    expect(langOf(t({ markets: ["gb"] }))).toBe("en");
    expect(langOf(t({ genre: "worldwide", markets: [] }))).toBe("");
  });

  it("hears romanised Hindi and Punjabi in a title filed under a Western genre", () => {
    expect(langOf(t({ title: "Hum Tere Pyar Mein (Reprise)", genre: "rock", markets: ["in"] }))).toBe("hi");
    expect(langOf(t({ title: "Jatt Da Pind", genre: "hip-hop/rap", markets: ["in"] }))).toBe("pa");
    expect(strongLang(t({ title: "Hold Me Closer", genre: "pop" }))).toBe("");
  });

  it("reads India's film songs and its own 'Hip-Hop' filing as Indian", () => {
    expect(langOf(t({ title: 'Soul Of Dia (From "Dia")', genre: "soundtrack", markets: ["in"] }))).toBe("in");
    expect(langOf(t({ title: "Still Rollin", genre: "hip-hop", markets: ["in"] }))).toBe("in");
  });

  it("reads Brazil's charts as Portuguese whatever genre they're filed under", () => {
    expect(langOf(t({ title: "Tropa do Capitão", genre: "funk", markets: ["br"] }))).toBe("pt");
  });

  it("calls a Western genre chart's song English even when only India charted it", () => {
    expect(langOf(t({ title: "Lady", genre: "country", markets: ["in"] }))).toBe("en");
    expect(langOf(t({ title: "Numb", genre: "hard rock", markets: ["ae"] }))).toBe("en");
  });

  it("lets an artist's other songs say what language they sing in", () => {
    const catalogue = [
      t({ title: "With You", artist: "AP Dhillon", genre: "punjabi pop" }),
      t({ title: "Excuses", artist: "AP Dhillon, Gurinder Gill", genre: "punjabi" }),
      t({ title: "Summer High", artist: "AP Dhillon & Gminxr", genre: "hip-hop/rap", markets: ["in"] }),
    ];
    const byArtist = artistLanguages(catalogue);
    expect(byArtist.get("ap dhillon")).toBe("pa");
    expect(langOf(catalogue[2], byArtist)).toBe("pa");
    expect(langOf(catalogue[2])).toBe("en"); // without the hint, the genre chart wins
  });

  it("groups the Indian languages", () => {
    for (const l of ["hi", "pa", "ta", "te", "ml", "kn", "mr", "bn", "in"]) expect(isIndianLang(l)).toBe(true);
    for (const l of ["en", "ko", "ar", "es", "", undefined]) expect(isIndianLang(l)).toBe(false);
  });
});

describe("fillerReason", () => {
  const f = (title: string, genre = "pop", artist = "Someone") => fillerReason({ title, artist, genre });

  it("catches karaoke, covers and tribute versions", () => {
    expect(f("Shape of You (Karaoke Version)")).toBe("cover");
    expect(f("Perfect (Originally Performed by Ed Sheeran)")).toBe("cover");
    expect(f("Hello (In the Style of Adele)")).toBe("cover");
    expect(f("Song", "pop", "Tribute to Queen")).toBe("cover");
  });

  it("catches sped-up, slowed and bass-boosted edits", () => {
    expect(f("Kesariya (Slowed + Reverb)")).toBe("variant");
    expect(f("Espresso (Sped Up)")).toBe("variant");
    expect(f("Tití Me Preguntó (Bass Boosted)")).toBe("variant");
    expect(f("Blinding Lights (Nightcore)")).toBe("variant");
  });

  it("catches instrumental, lo-fi and piano re-versions of a song", () => {
    expect(f("Kabir's Theme (Instrumental)", "bollywood")).toBe("variant");
    expect(f("Kale Kagaz (Lofi Mix)", "indian pop")).toBe("variant");
    expect(f("Love Story (Fast Piano Ver.)")).toBe("variant");
    expect(f("Numb [Instrumental]", "rock")).toBe("variant");
  });

  it("catches devotional spill and non-music genres", () => {
    expect(f("Shiv Tandav", "devotional & spiritual")).toBe("devotional");
    expect(f("Mera Ik Tuhi Waheguru", "worldwide")).toBe("devotional");
    expect(f("Sukh Tera Dita Layiye / Shabad Gurbani", "worldwide")).toBe("devotional");
    expect(f("Ujjain Mahakal Aarti Dhol", "worldwide")).toBe("devotional");
    expect(f("Sri Rudra Kavacham", "worldwide")).toBe("devotional");
    expect(f("Om Namah Shivaya", "worldwide", "Sanskar Bhakti")).toBe("devotional");
    // Apple files some of Sidhu Moose Wala under "New Age"; the genre alone proves nothing
    expect(f("Never Fold", "new age", "Sidhu Moose Wala")).toBeNull();
    expect(f("Mantra", "k-pop", "JENNIE")).toBeNull();
    expect(f("Rain Sounds", "sound effects")).toBe("filler");
    expect(f("Twinkle", "children's music")).toBe("filler");
  });

  it("leaves real songs alone, including ones that merely mention a word", () => {
    expect(f("Slow Down")).toBeNull();
    expect(f("Cover Me Up", "country")).toBeNull();
    expect(f("Tum Hi Ho", "bollywood")).toBeNull();
    expect(f("Speed Drive")).toBeNull();
    expect(f("Instrumental Love")).toBeNull(); // only a bracketed version tag counts
    expect(f("Pianos (Live)")).toBeNull();
    expect(f("Tauba Tauba", "sufi")).toBeNull();
  });
});

describe("curate", () => {
  const NOW = Date.parse("2026-09-27T00:00:00Z");
  const DAY = 86_400_000;
  const opts = { now: NOW, artistCap: 3, staleWeeks: 8, maxAgeYears: 5, oldChartDays: 14 };
  let n = 0;
  const track = (over: Partial<CurationTrack> = {}): CurationTrack => ({
    trackId: String(++n),
    title: `Song ${n}`,
    artist: `Artist ${n}`,
    genre: "pop",
    markets: ["us"],
    releaseDate: "2026-01-01",
    chartedAt: NOW - DAY,
    createdAt: NOW - 30 * DAY,
    ...over,
  });

  it("deals a fresh, charting song", () => {
    const t = track();
    expect(curate([t], opts).get(t.trackId)).toBeNull();
  });

  it("hides filler", () => {
    const t = track({ title: "Hit (Karaoke Version)" });
    expect(curate([t], opts).get(t.trackId)).toBe("cover");
  });

  it("stops dealing a song that left every chart more than staleWeeks ago", () => {
    const gone = track({ chartedAt: NOW - 9 * 7 * DAY });
    const recent = track({ chartedAt: NOW - 7 * 7 * DAY });
    const d = curate([gone, recent], opts);
    expect(d.get(gone.trackId)).toBe("stale");
    expect(d.get(recent.trackId)).toBeNull();
  });

  it("falls back to when the song arrived when it has never had a chart clock", () => {
    const old = track({ chartedAt: undefined, createdAt: NOW - 100 * DAY });
    expect(curate([old], opts).get(old.trackId)).toBe("stale");
  });

  it("keeps an old recording only while it is charting right now", () => {
    const charting = track({ releaseDate: "2009-06-01", chartedAt: NOW - 3 * DAY });
    const lapsed = track({ releaseDate: "2009-06-01", chartedAt: NOW - 20 * DAY });
    const newish = track({ releaseDate: "2024-06-01", chartedAt: NOW - 20 * DAY });
    const d = curate([charting, lapsed, newish], opts);
    expect(d.get(charting.trackId)).toBeNull();
    expect(d.get(lapsed.trackId)).toBe("old");
    expect(d.get(newish.trackId)).toBeNull(); // recent songs get the full staleWeeks
  });

  it("needs a sighting on a chart before keeping an old song from before the chart clock", () => {
    const unseen = track({ releaseDate: "1995-01-01", chartedAt: undefined, createdAt: NOW - DAY });
    const unseenNew = track({ releaseDate: "2025-01-01", chartedAt: undefined, createdAt: NOW - DAY });
    const d = curate([unseen, unseenNew], opts);
    expect(d.get(unseen.trackId)).toBe("old");
    expect(d.get(unseenNew.trackId)).toBeNull();
  });

  it("caps one artist at their strongest artistCap songs", () => {
    const songs = [0.9, 0.1, 0.5, 0, 0.7].map((heat) => track({ artist: "Kimo Sounds", heat }));
    const d = curate(songs, opts);
    const kept = songs.filter((s) => d.get(s.trackId) === null).map((s) => s.heat);
    expect(kept.sort()).toEqual([0.5, 0.7, 0.9]);
    expect(songs.filter((s) => d.get(s.trackId) === "artist-cap")).toHaveLength(2);
  });

  it("counts a featured credit toward the lead artist", () => {
    expect(leadArtist("Diljit Dosanjh, Sia & Friends")).toBe("diljit dosanjh");
    expect(leadArtist("Karan Aujla feat. Ikky")).toBe("karan aujla");
  });

  it("doesn't let hidden filler use up an artist's cap", () => {
    const filler = [1, 2, 3].map(() => track({ artist: "A", title: "X (Sped Up)", heat: 1 }));
    const real = track({ artist: "A", heat: 0 });
    expect(curate([...filler, real], opts).get(real.trackId)).toBeNull();
  });

  it("never touches an admin's decision, an artist's upload or an import", () => {
    const kept = track({ title: "Hit (Karaoke Version)", keep: true });
    const adminHidden = track({ hidden: true, hiddenBy: "admin" });
    const reportHidden = track({ hidden: true });
    const upload = track({ ownerUserId: "u1", chartedAt: 0, createdAt: 0 });
    const imported = track({ origin: "import", chartedAt: 0, createdAt: 0 });
    const d = curate([kept, adminHidden, reportHidden, upload, imported], opts);
    for (const t of [kept, adminHidden, reportHidden, upload, imported]) expect(d.has(t.trackId)).toBe(false);
  });

  it("releases its own hide when the reason is gone", () => {
    const back = track({ hidden: true, hiddenBy: "curation", chartedAt: NOW - DAY });
    expect(curate([back], opts).get(back.trackId)).toBeNull();
  });

  it("follows the admin's numbers", () => {
    const songs = [1, 2, 3, 4, 5].map(() => track({ artist: "B" }));
    const d = curate(songs, { ...opts, artistCap: 5 });
    expect(songs.every((s) => d.get(s.trackId) === null)).toBe(true);
  });
});
