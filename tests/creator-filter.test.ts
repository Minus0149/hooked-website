import { describe, expect, it } from "vitest";
import { filterTracks } from "../src/components/creator/filter";

const t = (title: string, artist: string, extra: Partial<{ hidden: boolean; active: boolean[]; moods: { mood: string; n: number }[] }> = {}) => ({
  title,
  artist,
  hidden: extra.hidden,
  hooks: (extra.active ?? [true]).map((active) => ({ active })),
  moods: extra.moods,
});

describe("finding a track in a big catalogue", () => {
  const tracks = [
    t("Halo", "Beyoncé", { moods: [{ mood: "tender", n: 3 }] }),
    t("Bounce", "Shubh", { active: [] }),
    t("Draft song", "Someone", { hidden: true }),
    t("Muted", "Band", { active: [false, false] }),
  ];

  it("searches title and artist, ignoring case and accents", () => {
    expect(filterTracks(tracks, "beyonce", "all").map((x) => x.title)).toEqual(["Halo"]);
    expect(filterTracks(tracks, "BOUNCE", "all").map((x) => x.title)).toEqual(["Bounce"]);
  });

  it("finds tracks the deck can't play a hook from, including all-muted ones", () => {
    expect(filterTracks(tracks, "", "needs-hooks").map((x) => x.title)).toEqual(["Bounce", "Muted"]);
  });

  it("separates drafts and mood-tagged tracks", () => {
    expect(filterTracks(tracks, "", "drafts").map((x) => x.title)).toEqual(["Draft song"]);
    expect(filterTracks(tracks, "", "tagged").map((x) => x.title)).toEqual(["Halo"]);
  });

  it("combines search with a filter", () => {
    expect(filterTracks(tracks, "halo", "drafts")).toEqual([]);
  });
});
