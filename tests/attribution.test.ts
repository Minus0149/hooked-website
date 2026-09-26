import { describe, expect, it } from "vitest";
import { appleMusicUrl, itunesId, ITUNES_CREDIT, needsItunesCredit } from "../src/lib/attribution";

/**
 * Apple lets us play its previews on two conditions we can see on screen: the
 * words "provided courtesy of iTunes", and a link to the item in its store.
 * The failure that matters is silent — a chart track that loses the credit, or
 * a creator's own upload that gains a claim it belongs to Apple.
 */
describe("iTunes attribution", () => {
  const t = (id: string, previewUrl = "") => ({ id, previewUrl, title: "Latch", artist: "Disclosure" });

  it("uses Apple's exact wording", () => {
    expect(ITUNES_CREDIT).toBe("provided courtesy of iTunes");
  });

  it("credits chart tracks and iTunes-matched imports", () => {
    expect(needsItunesCredit(t("1440833098"))).toBe(true);
    expect(needsItunesCredit(t("imp:itunes:1440833098"))).toBe(true);
    expect(itunesId(t("imp:itunes:1440833098"))).toBe("1440833098");
  });

  it("never credits Apple for a creator's upload or a Deezer preview", () => {
    expect(needsItunesCredit(t("own:abc123", "https://x.convex.cloud/api/storage/1"))).toBe(false);
    expect(needsItunesCredit(t("imp:deezer:3135556", "https://cdnt-preview.dzcdn.net/api/1/1.mp3"))).toBe(false);
  });

  it("credits audio served from Apple's preview CDN even under an unfamiliar id", () => {
    const url = "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x.m4a";
    expect(needsItunesCredit(t("legacy-7", url))).toBe(true);
  });

  it("links straight to the song on Apple Music when the id is Apple's", () => {
    expect(appleMusicUrl(t("1440833098"))).toBe("https://music.apple.com/us/song/1440833098");
    expect(appleMusicUrl(t("imp:itunes:42"))).toBe("https://music.apple.com/us/song/42");
    expect(appleMusicUrl(t("own:abc"))).toBe("https://music.apple.com/us/search?term=Latch%20Disclosure");
  });
});
