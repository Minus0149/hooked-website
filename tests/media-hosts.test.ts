import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaHostMessage, safeMediaUrl } from "../convex/mediaHosts";
import { cleanTrack } from "../convex/security";

/**
 * A creator's artwork or preview link could be any https address, which every
 * listener's device loaded and hookedcue.com's share images fetched from its
 * server. Only the catalogue's own hosts pass now (convex/mediaHosts.ts).
 */
const OWN = "https://shocking-goldfinch-745.convex.cloud";

describe("which media hosts a song may carry", () => {
  it("Apple's artwork and previews, Deezer's CDN and cdn.hookedcue.com", () => {
    for (const url of [
      "https://is1-ssl.mzstatic.com/image/thumb/Music122/x/600x600bb.jpg",
      "https://is5-ssl.mzstatic.com/a.jpg",
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/p.m4a",
      "https://e-cdns-images.dzcdn.net/images/cover/x/500x500.jpg",
      "https://cdns-preview-d.dzcdn.net/stream/c-abc.mp3",
      "https://cdn.hookedcue.com/art/x.jpg",
    ]) {
      expect(safeMediaUrl(url, OWN), url).toBe(url);
    }
  });

  it("this deployment's own storage, under /api/storage/ only", () => {
    expect(safeMediaUrl(`${OWN}/api/storage/abc-123`, OWN)).toBe(`${OWN}/api/storage/abc-123`);
    expect(safeMediaUrl(`${OWN}/api/query`, OWN)).toBeNull();
    expect(safeMediaUrl("https://someone-else-123.convex.cloud/api/storage/abc", OWN)).toBeNull();
    expect(safeMediaUrl(`${OWN}/api/storage/abc`, undefined)).toBeNull();
  });

  it("refuses everything else, and the tricks", () => {
    for (const url of [
      "https://evil.example/a.jpg",
      "http://is1-ssl.mzstatic.com/a.jpg",
      "https://mzstatic.com.evil.example/a.jpg",
      "https://evilmzstatic.com/a.jpg",
      "https://.mzstatic.com/a.jpg",
      "https://user:pw@is1-ssl.mzstatic.com/a.jpg",
      "https://is1-ssl.mzstatic.com:8443/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "",
    ]) {
      expect(safeMediaUrl(url, OWN), url).toBeNull();
    }
    expect(safeMediaUrl(123, OWN)).toBeNull();
    expect(safeMediaUrl(`https://is1-ssl.mzstatic.com/${"a".repeat(1200)}`, OWN)).toBeNull();
  });

  it("the catalogue writers (imports, charts) refuse a row on another host", () => {
    const row = {
      trackId: "imp:itunes:1",
      title: "t",
      artist: "a",
      album: "",
      artwork: "https://is1-ssl.mzstatic.com/a.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/p.m4a",
      durationMs: 1000,
      genre: "pop",
      accent: "#ff3d71",
    };
    expect(cleanTrack(row).artwork).toBe(row.artwork);
    expect(() => cleanTrack({ ...row, artwork: "https://tracker.example/pixel.gif" })).toThrow(/Artwork URL must be on/);
    expect(() => cleanTrack({ ...row, previewUrl: "https://evil.example/a.m4a" })).toThrow(/Preview URL must be on/);
  });

  it("a creator's new track takes a listed host or nothing, with a plain message", () => {
    const src = readFileSync(resolve(__dirname, "..", "convex", "creators.ts"), "utf8");
    const create = src.slice(src.indexOf("export const createTrack"), src.indexOf("export const setTrackHidden"));
    expect(create).toMatch(/safeMediaUrl\(url, process\.env\.CONVEX_CLOUD_URL\)/);
    expect(create).toMatch(/throw new ConvexError\(mediaHostMessage\(field\)\)/);
    expect(create).toMatch(/artwork: media\(args\.artwork, "Artwork"\)/);
    expect(create).toMatch(/previewUrl: media\(args\.previewUrl \?\? "", "Preview"\)/);
    expect(mediaHostMessage("Artwork")).toMatch(/mzstatic/);
    expect(src).toMatch(/export const scrubMediaUrls = internalMutation/);
  });
});
