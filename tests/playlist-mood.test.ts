import { describe, expect, it } from "vitest";
import { nameAfterMoodPick } from "../src/lib/playlistMood";
import { moodPlaylistName } from "../src/data/mood";

describe("picking a mood for a new playlist", () => {
  it("fills an empty name with the mood's", () => {
    expect(nameAfterMoodPick("", "", "chill")).toEqual({
      name: moodPlaylistName("chill"),
      filled: moodPlaylistName("chill"),
    });
  });

  it("swaps a filled-in name when the mood changes", () => {
    const first = nameAfterMoodPick("", "", "chill");
    const second = nameAfterMoodPick(first.name, first.filled, "party");
    expect(second.name).toBe(moodPlaylistName("party"));
  });

  it("never replaces a name the listener typed", () => {
    expect(nameAfterMoodPick("gym bangers", "", "hyped")).toEqual({ name: "gym bangers", filled: "" });
    // even after an earlier pick had filled the box
    const first = nameAfterMoodPick("", "", "chill");
    expect(nameAfterMoodPick("my own", first.filled, "sunny").name).toBe("my own");
  });

  it("clears only a filled-in name when going back to Any", () => {
    const first = nameAfterMoodPick("", "", "tender");
    expect(nameAfterMoodPick(first.name, first.filled, null).name).toBe("");
    expect(nameAfterMoodPick("late drives", first.filled, null).name).toBe("late drives");
  });
});
