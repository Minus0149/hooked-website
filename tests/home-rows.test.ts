import { describe, expect, it } from "vitest";
import { becauseRows } from "../src/lib/homeRows";
import type { Track } from "../src/types";

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
const catalog = [prayer, prayerTwin, badName, queen, zombie, piano];

const base = {
  catalog,
  boostGenres: ["Rock"],
  liked: [] as Track[],
  discoveries: [] as Track[],
  playlists: [] as { tracks: Track[] }[],
  queue: [] as Track[],
  neverArtists: [] as string[],
  neverTracks: [] as string[],
};

const ids = (rows: ReturnType<typeof becauseRows>) => rows.flatMap((r) => r.tracks.map((t) => t.id));

describe("Home 'Because you wanted more' rows", () => {
  it("never suggest an artist the listener just swiped Never on", () => {
    const rows = becauseRows({ ...base, neverArtists: ["Bon Jovi"], neverTracks: ["1"] });
    expect(ids(rows)).toEqual(["4", "5", "6"]);
  });

  it("keep a buried song buried under its twin's id", () => {
    const rows = becauseRows({ ...base, neverTracks: ["1"] });
    expect(ids(rows)).not.toContain("1");
    expect(ids(rows)).not.toContain("2");
    expect(ids(rows)).toContain("3");
  });

  it("skip songs already kept in Liked, Discoveries or a playlist", () => {
    const rows = becauseRows({
      ...base,
      liked: [queen],
      discoveries: [zombie],
      playlists: [{ tracks: [prayerTwin] }],
    });
    expect(ids(rows)).toEqual(["3", "6"]);
  });

  it("skip what the deck is about to play", () => {
    expect(ids(becauseRows({ ...base, queue: [piano] }))).not.toContain("6");
  });

  it("honour the Settings toggles that let blocked artists and buried songs back", () => {
    const rows = becauseRows({
      ...base,
      neverArtists: ["Bon Jovi"],
      neverTracks: ["1"],
      includeBlockedArtists: true,
      includeBuried: true,
    });
    expect(ids(rows)).toEqual(["1", "3", "4", "5", "6"]);
  });

  it("fall back to the genres of Liked songs and drop empty rows", () => {
    const rows = becauseRows({ ...base, boostGenres: [], liked: [track("9", "X", "Y", "Pop"), queen] });
    expect(rows.map((r) => r.genre)).toEqual(["Rock"]);
  });
});
