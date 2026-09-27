import { describe, expect, it } from "vitest";
import {
  cleanCode,
  CODE_LENGTH,
  inviteLink,
  isFoundingListener,
  makeCode,
  referralDecision,
  type ReferralInput,
} from "../convex/referralRules";
import { computeRecap, type RecapSwipe } from "../convex/recapRules";
import { isRecapDay, recapStoryUrl, refFromSearch, songShareUrl, songStoryUrl } from "../src/lib/growth";

/**
 * Invite links approve people past the waitlist, so their rules are the part
 * that must never be generous by accident: one approval per email, no
 * self-invites, no un-rejecting, and a hard allowance.
 */
describe("invite codes", () => {
  it("makes codes the parser accepts, without look-alike characters", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const code = makeCode(rand);
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).not.toMatch(/[01ILO]/);
      expect(cleanCode(code.toLowerCase())).toBe(code);
      expect(refFromSearch(`?ref=${code}`)).toBe(code);
    }
  });

  it("rejects junk codes", () => {
    for (const bad of ["", "ABC", "ABCDEFGH", "ABCDE0I", 42, null, "ab cd ef"]) {
      expect(cleanCode(bad as unknown)).toBeNull();
    }
    expect(refFromSearch("?ref=<script>")).toBeNull();
    expect(refFromSearch("")).toBeNull();
  });

  const base: ReferralInput = {
    cap: 3,
    inviter: { userId: "u1", email: "minus@example.com" },
    applicantEmail: "friend@example.com",
    existingStatus: null,
    used: 0,
  };

  it("approves a new friend while the inviter has invites left", () => {
    expect(referralDecision(base)).toBe("approve");
    expect(referralDecision({ ...base, existingStatus: "pending" })).toBe("approve");
    expect(referralDecision({ ...base, used: 2 })).toBe("approve");
  });

  it("stops at the allowance, and 0 switches invites off", () => {
    expect(referralDecision({ ...base, used: 3 })).toBe("ignore");
    expect(referralDecision({ ...base, cap: 0 })).toBe("ignore");
  });

  it("never approves an unknown code, a self-invite, or overrides a decision", () => {
    expect(referralDecision({ ...base, inviter: null })).toBe("ignore");
    expect(referralDecision({ ...base, applicantEmail: " MINUS@example.com " })).toBe("ignore");
    expect(referralDecision({ ...base, existingStatus: "rejected" })).toBe("ignore");
    expect(referralDecision({ ...base, existingStatus: "approved" })).toBe("ignore");
  });

  it("earns the founding listener badge at two friends who joined", () => {
    expect(isFoundingListener(1)).toBe(false);
    expect(isFoundingListener(2)).toBe(true);
  });

  it("links to the landing's beta form with the code", () => {
    expect(inviteLink("https://hookedcue.com/", "ABCDEFG")).toBe("https://hookedcue.com/beta?ref=ABCDEFG");
  });
});

describe("share links", () => {
  it("points at the song, and at a hook other than the first", () => {
    expect(songShareUrl("1440857781")).toBe("https://hookedcue.com/s/1440857781");
    expect(songShareUrl("1440857781", 2)).toBe("https://hookedcue.com/s/1440857781?h=2");
    expect(songShareUrl("own:abc/1")).toBe("https://hookedcue.com/s/own%3Aabc%2F1");
    expect(songStoryUrl("1440857781", 1)).toBe("https://hookedcue.com/s/1440857781/story?h=1");
  });

  it("puts only the shared numbers in the recap image link", () => {
    const url = new URL(
      recapStoryUrl({
        firstName: "Minus",
        cards: 214.4,
        saves: 19,
        newArtists: 6,
        saveRate: 0.088,
        topMoods: ["party", "chill", "sunny", "sleepy"],
        topArtist: "AP Dhillon",
        until: Date.UTC(2026, 8, 27),
      }),
    );
    expect(url.pathname).toBe("/r/story");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      n: "Minus",
      c: "214",
      s: "19",
      a: "6",
      r: "9",
      m: "party,chill,sunny",
      t: "AP Dhillon",
      w: "2026-09-27",
    });
  });
});

describe("week in hooks", () => {
  const s = (action: RecapSwipe["action"], artist: string, trackId = artist + action, genre = "pop"): RecapSwipe => ({
    action,
    artist,
    trackId,
    genre,
  });

  it("counts cards, saves and the save rate", () => {
    const r = computeRecap(
      [s("save", "A"), s("skip", "B"), s("skip", "C"), s("more", "D"), s("never", "E")],
      new Set(),
    );
    expect(r).toMatchObject({ cards: 5, saves: 1, skips: 2, more: 1, nevers: 1, saveRate: 0.2 });
  });

  it("counts an artist as new only if they were never saved before the week", () => {
    const r = computeRecap([s("save", "Old Friend"), s("save", "New One"), s("save", "new one", "x2")], new Set(["old friend"]));
    expect(r.newArtists).toBe(1);
  });

  it("ranks top artists and genres, and ignores skips for genres", () => {
    const r = computeRecap(
      [s("save", "A", "1", "house"), s("save", "A", "2", "house"), s("save", "B", "3", "rap"), s("skip", "C", "4", "metal")],
      new Set(),
    );
    expect(r.topArtists[0]).toBe("A");
    expect(r.topGenres).toEqual(["house", "rap"]);
  });

  it("shows on Sundays and Mondays", () => {
    expect(isRecapDay(new Date(2026, 8, 27))).toBe(true); // Sunday
    expect(isRecapDay(new Date(2026, 8, 28))).toBe(true); // Monday
    expect(isRecapDay(new Date(2026, 8, 29))).toBe(false);
  });
});
