import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Track } from "../src/types";
import { HAS_MOBILE } from "./mobile-sibling";

/**
 * The phone's Home rows ("Because you wanted more rock") skipped only Liked
 * songs, like the web's did before 07cf641: a swipe left on Bon Jovi was
 * followed at once by "Livin' On A Prayer, Bon Jovi" on Home. The phone now
 * uses the same lib/homeRows.ts.
 */
const MOBILE_LIB = new URL("../../mobile/src/lib/homeRows.ts", import.meta.url).href;
const { becauseRows } = HAS_MOBILE
  ? ((await import(/* @vite-ignore */ MOBILE_LIB)) as typeof import("../../mobile/src/lib/homeRows"))
  : { becauseRows: () => [] as { genre: string; tracks: Track[] }[] };

const track = (id: string, title: string, artist: string, genre = "Rock"): Track => ({
  id,
  title,
  artist,
  album: "",
  artwork: "",
  previewUrl: "",
  durationMs: 30000,
  genre,
  accent: "#fff",
});

const prayer = track("1", "Livin' On a Prayer", "Bon Jovi");
const prayerTwin = track("2", "Livin' On A Prayer", "Bon Jovi");
const badName = track("3", "You Give Love a Bad Name", "Bon Jovi");
const queen = track("4", "Killer Queen", "Queen");
const zombie = track("5", "Zombie", "The Cranberries");
const piano = track("6", "Piano Man", "Billy Joel");

const base = {
  catalog: [prayer, prayerTwin, badName, queen, zombie, piano],
  boostGenres: ["Rock"],
  liked: [] as Track[],
  discoveries: [] as Track[],
  playlists: [] as { tracks: Track[] }[],
  queue: [] as Track[],
  neverArtists: [] as string[],
  neverTracks: [] as string[],
};
const ids = (rows: { tracks: Track[] }[]) => rows.flatMap((r) => r.tracks.map((t) => t.id));

describe.skipIf(!HAS_MOBILE)("the phone's 'Because you wanted more' rows", () => {
  it("never suggest an artist the listener swiped Never on", () => {
    expect(ids(becauseRows({ ...base, neverArtists: ["Bon Jovi"], neverTracks: ["1"] }))).toEqual(["4", "5", "6"]);
  });

  it("keep a buried song buried under its twin's id", () => {
    const got = ids(becauseRows({ ...base, neverTracks: ["1"] }));
    expect(got).not.toContain("1");
    expect(got).not.toContain("2");
    expect(got).toContain("3");
  });

  it("skip songs already kept in Liked, Discoveries or a playlist", () => {
    const rows = becauseRows({ ...base, liked: [queen], discoveries: [zombie], playlists: [{ tracks: [prayerTwin] }] });
    expect(ids(rows)).toEqual(["3", "6"]);
  });

  it("let blocked artists and buried songs back only when Settings say so", () => {
    const rows = becauseRows({
      ...base,
      neverArtists: ["Bon Jovi"],
      neverTracks: ["1"],
      includeBlockedArtists: true,
      includeBuried: true,
    });
    expect(ids(rows)).toEqual(["1", "3", "4", "5", "6"]);
  });

  it("Home feeds the rows everything they need to keep those promises", () => {
    const home = readFileSync("../mobile/src/components/HomeScreen.tsx", "utf8");
    expect(home).toMatch(/from "\.\.\/lib\/homeRows"/);
    for (const field of ["discoveries,", "playlists,", "neverArtists: state.neverArtists", "neverTracks: state.neverTracks", "includeBuried: state.prefs.includeBuried", "includeBlockedArtists: state.prefs.includeBlockedArtists"]) {
      expect(home).toContain(field);
    }
    expect(readFileSync("../mobile/scripts/check-mirrors.mjs", "utf8")).toContain('"lib/homeRows.ts"');
  });
});
