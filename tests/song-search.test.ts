import { describe, expect, it } from "vitest";
import { normalizeText, searchSongs } from "../src/lib/songSearch";

/** Song search runs on the catalogue already on the device (Minus, 2026-10-20). */
const songs = [
  { id: "1", title: "Kesariya", artist: "Pritam, Arijit Singh", album: "Brahmastra", heat: 0.9 },
  { id: "2", title: "Tum Hi Ho", artist: "Arijit Singh", album: "Aashiqui 2", heat: 0.5 },
  { id: "3", title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", heat: 1 },
  { id: "4", title: "Despacito", artist: "Luis Fonsi & Daddy Yankee", album: "VIDA" },
  { id: "5", title: "Kesariya (From \"Brahmastra\")", artist: "Pritam, Arijit Singh", album: "Brahmastra" },
  { id: "6", title: "Café Con Leche", artist: "Ana Belén" },
  { id: "7", title: "केसरिया", artist: "अरिजीत सिंह" },
  { id: "8", title: "Tum Hi Ho", artist: "Arijit Singh", album: "Aashiqui 2 (Deluxe)" },
  { id: "9", title: "The Arijit Singh Classic Mashup", artist: "Dj Kiran Kamath", heat: 1 },
  { id: "10", title: "Anjithal", artist: "Haricharan", heat: 1 },
];
const ids = (q: string) => searchSongs(songs, q).map((s) => s.id);

describe("song search", () => {
  it("puts the exact title first, then titles that start with it", () => {
    expect(ids("kesariya").slice(0, 2)).toEqual(["1", "5"]);
  });

  it("finds an artist from the first letters of each word", () => {
    const got = ids("ari sin");
    expect(got).toContain("1");
    expect(got).toContain("2");
    expect(got).not.toContain("3");
  });

  it("ranks the artist's own songs above a title that merely names them", () => {
    const got = ids("ari sin");
    expect(got.indexOf("2")).toBeLessThan(got.indexOf("9"));
    expect(got.indexOf("1")).toBeLessThan(got.indexOf("9"));
  });

  it("needs every word to match", () => {
    expect(ids("tum ho")).toEqual(["2"]);
    expect(ids("tum weeknd")).toEqual([]);
  });

  it("ignores case, accents and punctuation", () => {
    expect(ids("CAFE con")).toEqual(["6"]);
    expect(normalizeText("Kesariya (From \"Brahmastra\")")).toBe("kesariya from brahmastra");
  });

  it("searches Hindi script as written", () => {
    expect(ids("केसरिया")).toEqual(["7"]);
    expect(ids("अरिजीत")).toEqual(["7"]);
  });

  it("forgives one typo in a long word when nothing matches exactly", () => {
    expect(ids("arjit")).toEqual(expect.arrayContaining(["1", "2"]));
    // a typo against a whole word beats a typo against the start of a longer one
    const got = ids("arjit");
    expect(got.indexOf("2")).toBeLessThan(got.indexOf("10"));
    expect(ids("despacitp")).toEqual(["4"]);
  });

  it("matches the album too, below title and artist", () => {
    expect(ids("after hours")).toEqual(["3"]);
  });

  it("shows the same song once", () => {
    expect(ids("tum hi ho")).toEqual(["2"]);
  });

  it("returns nothing for an empty or punctuation-only query, and honours the limit", () => {
    expect(ids("   ")).toEqual([]);
    expect(ids("!!!")).toEqual([]);
    expect(searchSongs(songs, "a", 2)).toHaveLength(2);
  });
});
