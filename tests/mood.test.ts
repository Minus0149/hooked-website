import { describe, expect, it } from "vitest";
import {
  coerceMood,
  coerceMoodByTime,
  DAYPART_ENERGY,
  DAYPART_MOOD,
  daypartAt,
  MOODS,
  MOOD_IDS,
  moodById,
  moodFit,
  moodFitFor,
  moodsForHour,
  moodsOf,
  type Daypart,
  type MoodId,
} from "../src/data/mood";

/**
 * Moods decide what the deck offers at 1am, and the failure mode is quiet: a
 * mood that matches nothing leaves the deck exactly as it was, and the face
 * still lights up. Nobody would notice for weeks. So the invariants worth
 * holding are the ones a screenshot can't show — that every hour of the day
 * lands in exactly one block, that a ghazal reads as tender rather than as
 * party, and that one person's vote cannot rename a song.
 */

const at = (hour: number, minute = 0) => new Date(2026, 8, 23, hour, minute, 0);

describe("the mood taxonomy", () => {
  it("is six distinct faces", () => {
    expect(MOODS).toHaveLength(6);
    expect(new Set(MOOD_IDS).size).toBe(6);
  });

  it("orders them loudest to quietest, so the fan has a direction", () => {
    const energies = MOODS.map((m) => m.energy);
    expect([...energies].sort((a, b) => b - a)).toEqual(energies);
  });

  it("keeps both axes inside the plane they came from", () => {
    for (const m of MOODS) {
      expect(m.energy).toBeGreaterThanOrEqual(0);
      expect(m.energy).toBeLessThanOrEqual(1);
      expect(m.valence).toBeGreaterThanOrEqual(0);
      expect(m.valence).toBeLessThanOrEqual(1);
      expect(m.match.length).toBeGreaterThan(0);
    }
  });

  it("puts the quiet, sad corner where a ghazal belongs", () => {
    const tender = moodById("tender")!;
    expect(tender.energy).toBeLessThan(0.4);
    expect(tender.valence).toBeLessThan(0.4);
    expect(tender.match).toContain("ghazal");
  });

  it("narrows anything a server or an old device hands it", () => {
    expect(coerceMood("party")).toBe("party");
    expect(coerceMood("PARTY")).toBeNull();
    expect(coerceMood("disco-nap")).toBeNull();
    expect(coerceMood(undefined)).toBeNull();
    expect(coerceMood(7)).toBeNull();
  });
});

describe("how well a track answers a mood", () => {
  const fitOf = (genre: string, id: MoodId, over: { energy?: number } = {}) =>
    moodFit({ genre, ...over }, moodById(id)!);

  it("reads a ghazal as tender, not as a party", () => {
    expect(fitOf("Ghazals", "tender")).toBeGreaterThan(0.9);
    expect(fitOf("Ghazals", "party")).toBeLessThan(0.1);
  });

  it("reads house as a party", () => {
    expect(fitOf("house", "party")).toBeGreaterThan(0.9);
    expect(fitOf("house", "sleepy")).toBeLessThan(0.1);
  });

  it("matches however the provider punctuated the genre", () => {
    // the bundled catalogue says "hip hop"; Apple's charts say "Hip-Hop/Rap"
    expect(fitOf("hip hop", "hyped")).toBeGreaterThan(0.9);
    expect(fitOf("Hip-Hop/Rap", "hyped")).toBeGreaterThan(0.9);
  });

  it("has no opinion about a track it knows nothing about", () => {
    expect(moodFit({ genre: "" }, moodById("party")!)).toBe(0);
  });

  it("lets measured loudness speak when the genre doesn't", () => {
    // an unfamiliar genre string, but the analyser measured it as quiet
    const quiet = fitOf("bedroom whatever", "sleepy", { energy: 0.1 });
    const loud = fitOf("bedroom whatever", "sleepy", { energy: 0.95 });
    expect(quiet).toBeGreaterThan(loud);
    // and it never outvotes the genre on its own
    expect(quiet).toBeLessThan(0.5);
  });

  it("lets the crowd overrule how a song is filed", () => {
    // filed as pop, but ten listeners say it's a party record
    const asFiled = moodFit({ genre: "pop" }, moodById("party")!);
    const asHeard = moodFit({ genre: "pop" }, moodById("party")!, { party: 10 });
    expect(asHeard).toBeGreaterThan(asFiled);
    expect(asHeard).toBeGreaterThan(0.5);
  });

  it("treats one lone vote as a hint, not a fact", () => {
    const one = moodFit({ genre: "pop" }, moodById("party")!, { party: 1 });
    const many = moodFit({ genre: "pop" }, moodById("party")!, { party: 8 });
    expect(one).toBeLessThan(many);
  });

  it("splits a disputed song between the moods people named", () => {
    const votes = { party: 4, tender: 4 };
    const party = moodFit({ genre: "indie rock" }, moodById("party")!, votes);
    const tender = moodFit({ genre: "indie rock" }, moodById("tender")!, votes);
    expect(party).toBeCloseTo(tender, 5);
  });

  it("looks the crowd's votes up by track id for the ranker", () => {
    const track = { id: "t1", genre: "pop" };
    const crowd = { t1: { sleepy: 6 as number } };
    expect(moodFitFor(track, "sleepy", crowd)).toBeGreaterThan(
      moodFitFor(track, "sleepy", {}),
    );
    // and an absent lens is not an opinion of zero fit, it is no question asked
    expect(moodFitFor(track, null, crowd)).toBe(0);
  });

  it("names the moods a track reads as, strongest first", () => {
    expect(moodsOf({ genre: "Ghazals" })[0]).toBe("tender");
    expect(moodsOf({ genre: "deep house" })[0]).toBe("party");
    expect(moodsOf({ genre: "nothing recognisable" })).toEqual([]);
  });
});

describe("the clock", () => {
  it("puts every hour of the day in exactly one block", () => {
    const parts = new Map<number, Daypart>();
    for (let h = 0; h < 24; h++) parts.set(h, daypartAt(at(h)));
    expect(parts.size).toBe(24);
    expect(new Set(parts.values()).size).toBe(5);
  });

  it("cuts the blocks where it says it does", () => {
    expect(daypartAt(at(0, 1))).toBe("lateNight");
    expect(daypartAt(at(4, 59))).toBe("lateNight");
    expect(daypartAt(at(5))).toBe("morning");
    expect(daypartAt(at(11, 59))).toBe("morning");
    expect(daypartAt(at(12))).toBe("afternoon");
    expect(daypartAt(at(17))).toBe("evening");
    expect(daypartAt(at(21, 59))).toBe("evening");
    expect(daypartAt(at(22))).toBe("night");
    expect(daypartAt(at(23, 59))).toBe("night");
  });

  it("suggests the quiet ones after midnight and the loud ones at noon", () => {
    // the shape the listening research actually found: post-midnight is low
    // arousal, loudness peaks around midday
    expect(DAYPART_ENERGY.lateNight).toBeLessThan(DAYPART_ENERGY.afternoon);
    expect(DAYPART_ENERGY.afternoon).toBe(
      Math.max(...Object.values(DAYPART_ENERGY)),
    );
    expect(moodById(DAYPART_MOOD.lateNight)!.energy).toBeLessThan(0.3);
    expect(moodById(DAYPART_MOOD.afternoon)!.energy).toBeGreaterThan(0.8);
  });

  it("answers the two hours the feature was asked for", () => {
    // "in the night, ghazals; in the day, party songs to keep it active"
    expect(DAYPART_MOOD.night).toBe("tender");
    expect(moodById(DAYPART_MOOD.night)!.match).toContain("ghazal");
    expect(DAYPART_MOOD.evening).toBe("party");
  });

  it("leads with the hour's mood and sorts the rest around it", () => {
    const late = moodsForHour(at(1));
    expect(late[0].id).toBe("sleepy");
    expect(late).toHaveLength(6);
    expect(new Set(late.map((m) => m.id)).size).toBe(6);
    // quiet faces come before loud ones at 1am
    expect(late.findIndex((m) => m.id === "tender")).toBeLessThan(
      late.findIndex((m) => m.id === "hyped"),
    );

    const evening = moodsForHour(at(19));
    expect(evening[0].id).toBe("party");
    expect(evening.findIndex((m) => m.id === "hyped")).toBeLessThan(
      evening.findIndex((m) => m.id === "sleepy"),
    );
  });

  it("defaults the clock to suggesting rather than deciding", () => {
    expect(coerceMoodByTime(undefined)).toBe("suggest");
    expect(coerceMoodByTime("nonsense")).toBe("suggest");
    expect(coerceMoodByTime("off")).toBe("off");
    expect(coerceMoodByTime("always")).toBe("always");
  });
});
