import { describe, expect, it } from "vitest";
import { APP_ORIGIN, cdnBase, cdnConfig, cdnKey, servesApp, staleKeys } from "../convex/catalogCdn";
import { encodeCatalog, fetchCatalog, partUrls, ROWS_PER_PART, type CatalogTrack } from "../src/lib/catalogCodec";

/**
 * The catalogue's copy on Cloudflare R2. Serving it from Convex counted every
 * client download against the free plan's file bandwidth; R2 has no egress
 * charge. The copy must never be the only way in: clients fall back to Convex,
 * and the server only advertises the copy once the app can actually read it.
 */

const env = {
  R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com/",
  R2_BUCKET: "hookedcue-catalog",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_PUBLIC_BASE: "https://cdn.hookedcue.com/",
};

describe("the R2 copy's configuration", () => {
  it("needs all five variables", () => {
    expect(cdnConfig(env)).toMatchObject({ endpoint: "https://abc123.r2.cloudflarestorage.com", publicBase: "https://cdn.hookedcue.com" });
    for (const key of Object.keys(env)) {
      expect(cdnConfig({ ...env, [key]: undefined })).toBeNull();
      expect(cdnConfig({ ...env, [key]: "  " })).toBeNull();
    }
  });

  it("refuses plain-http addresses", () => {
    expect(cdnConfig({ ...env, R2_PUBLIC_BASE: "http://cdn.hookedcue.com" })).toBeNull();
  });
});

describe("where a version lives", () => {
  it("keeps each version in its own folder", () => {
    expect(cdnKey(19, 3)).toBe("catalog/v19/3.json");
    expect(cdnBase("https://cdn.hookedcue.com/", 19)).toBe("https://cdn.hookedcue.com/catalog/v19");
  });

  it("prunes only versions older than the one kept, and nothing outside the catalogue", () => {
    const keys = ["catalog/v17/0.json", "catalog/v18/0.json", "catalog/v18/1.json", "catalog/v19/0.json", "probe.json", "catalog/readme"];
    expect(staleKeys(keys, 18)).toEqual(["catalog/v17/0.json"]);
    expect(staleKeys(keys, 1)).toEqual([]);
  });
});

describe("whether the copy serves the app", () => {
  const res = (ok: boolean, allow: string | null) => ({ ok, headers: { get: (n: string) => (n === "access-control-allow-origin" ? allow : null) } });
  it("needs the file and the app's CORS permission", () => {
    expect(servesApp(res(true, APP_ORIGIN))).toBe(true);
    expect(servesApp(res(true, "*"))).toBe(true);
    // a domain not yet connected answers from elsewhere; CORS not set up blocks the browser
    expect(servesApp(res(false, null))).toBe(false);
    expect(servesApp(res(true, null))).toBe(false);
    expect(servesApp(res(true, "https://evil.example"))).toBe(false);
  });
});

describe("clients reading the copy", () => {
  const apple: CatalogTrack = {
    trackId: "1",
    title: "Song",
    artist: "Artist",
    album: "Album",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cb/x/Cover.jpg/600x600bb.jpg",
    previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/c6/x.m4a",
    durationMs: 200_000,
    genre: "Pop",
    accent: "#7c5cff",
    markets: ["in"],
    audioUrl: null,
    hooks: [{ id: "h1", startMs: 1000, durationMs: 15000 }],
  };
  const docs = encodeCatalog(
    Array.from({ length: ROWS_PER_PART + 5 }, (_, i) => ({ ...apple, trackId: String(9_000_000 + i) })),
    21,
  );
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const cdnPart = (url: string) => /\/(\d+)\.json/.exec(url)?.[1];
  const convexPart = (url: string) => new URL(url).searchParams.get("part");
  const ver = { v: 21, parts: 2, cdn: "https://cdn.hookedcue.com/catalog/v21" };

  it("tries the CDN first, then Convex", () => {
    expect(partUrls("https://x.convex.site", ver, 1)).toEqual([
      "https://cdn.hookedcue.com/catalog/v21/1.json",
      "https://x.convex.site/catalog?v=21&part=1",
    ]);
    expect(partUrls("https://x.convex.site", { v: 21, parts: 2 }, 1)).toEqual(["https://x.convex.site/catalog?v=21&part=1"]);
  });

  it("downloads from the CDN alone when it answers", async () => {
    const seen: string[] = [];
    const got = await fetchCatalog("https://x.convex.site", ver, (url) => {
      seen.push(url);
      return ok(JSON.parse(JSON.stringify(docs[Number(cdnPart(url))])));
    });
    expect(got.tracks).toHaveLength(ROWS_PER_PART + 5);
    expect(seen.every((u) => u.startsWith("https://cdn.hookedcue.com/"))).toBe(true);
  });

  it("falls back to Convex when the CDN fails", async () => {
    const seen: string[] = [];
    const got = await fetchCatalog(
      "https://x.convex.site",
      ver,
      (url) => {
        seen.push(url);
        if (url.startsWith("https://cdn.")) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
        return ok(JSON.parse(JSON.stringify(docs[Number(convexPart(url))])));
      },
      [20, 20, 20],
    );
    expect(got.version).toBe(21);
    expect(seen.filter((u) => u.includes("convex.site"))).toHaveLength(2);
    expect(seen.filter((u) => u.includes("convex.site")).every((u) => u.includes("&retry=1"))).toBe(true);
  });
});
