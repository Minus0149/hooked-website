import { describe, expect, it } from "vitest";
import {
  CATALOG_FORMAT,
  catalogAction,
  catalogUrl,
  decodePart,
  joinParts,
  ROWS_PER_PART,
  decodeTrack,
  encodeCatalog,
  encodeTrack,
  fetchCatalog,
  packArtwork,
  packPreview,
  unpackArtwork,
  unpackPreview,
  type CatalogTrack,
} from "../src/lib/catalogCodec";

/**
 * The catalogue moved off the websocket into a compact file (convex/catalog.ts).
 * Every client decodes what the server encodes, so the one thing that must
 * never happen is a lossy round trip: a hook id, an Apple URL or a sound vector
 * coming back different would mis-credit plays, break artwork or skew ranking.
 */

const apple: CatalogTrack = {
  trackId: "1440857781",
  title: "exile (feat. Bon Iver)",
  artist: "Taylor Swift",
  album: "folklore",
  artwork:
    "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cb/2c/f6/cb2cf665-bbe2-5e32-f1d2-0d806afb5e00/00792755623855_Cover.jpg/600x600bb.jpg",
  previewUrl:
    "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/c6/8a/eb/c68aebc7-ecac-d7ba-2e69-5569bf9fd580/mzaf_3236106917395381199.plus.aac.p.m4a",
  durationMs: 285_640,
  genre: "Alternative",
  accent: "#7c5cff",
  markets: ["gb", "in"],
  heat: 0.25,
  energy: 0.412,
  sound: "AQL/+wz9Bw4A8ALp+gUC/Qb8+fsQ/gP4AQYD9gH9CvE=",
  audioMood: [0.12, 0.7, 0.33, 0.05, 0.91, 0.4],
  vocal: 0.8,
  audioUrl: null,
  hooks: [
    { id: "kx794zxxa59zqv6hgtvvbq2zys8f4z29", startMs: 10_220, durationMs: 9_600 },
    { id: "kx7cefx8tdvcp691xq7dd6xvzh8f43jf", startMs: 1_022, durationMs: 9_600, label: "chorus" },
  ],
};

const creator: CatalogTrack = {
  trackId: "own:abc",
  title: "Bedroom Tape",
  artist: "Some Indie",
  album: "",
  artwork: "https://example.org/cover.png",
  previewUrl: "",
  durationMs: 180_000,
  genre: "Indie",
  accent: "#ff3d71",
  audioUrl: "https://shocking-goldfinch-745.convex.cloud/api/storage/0b1c",
  hooks: [{ id: "kx7aaaaaaaaaaaaaaaaaaaaaaaaaaaaa", startMs: 42_000, durationMs: 12_000 }],
};

describe("catalogue codec", () => {
  it("round-trips an Apple chart track exactly", () => {
    expect(decodeTrack(encodeTrack(apple))).toEqual(apple);
  });

  it("round-trips a creator upload with its own audio and no preview", () => {
    const back = decodeTrack(encodeTrack(creator));
    expect(back).toEqual(creator);
  });

  it("drops empty trailing fields but keeps the ones that matter", () => {
    const bare: CatalogTrack = { ...creator, audioUrl: null };
    const row = encodeTrack(bare);
    expect(row.length).toBe(10); // nothing after the hooks column
    const back = decodeTrack(row);
    expect(back.audioUrl).toBeNull();
    expect(back.hooks).toEqual(creator.hooks);
  });

  it("compacts Apple URLs and restores them byte for byte", () => {
    const a = packArtwork(apple.artwork);
    expect(a.startsWith("~1")).toBe(true);
    expect(a.length).toBeLessThan(apple.artwork.length - 50);
    expect(unpackArtwork(a)).toBe(apple.artwork);
    const p = packPreview(apple.previewUrl);
    expect(p.startsWith("~")).toBe(true);
    expect(unpackPreview(p)).toBe(apple.previewUrl);
  });

  it("leaves non-Apple and odd-sized artwork untouched", () => {
    expect(packArtwork(creator.artwork)).toBe(creator.artwork);
    const odd = apple.artwork.replace("600x600bb.jpg", "300x300bb.jpg");
    expect(packArtwork(odd)).toBe(odd);
    expect(packPreview("https://cdns-preview-0.dzcdn.net/x.mp3")).toBe("https://cdns-preview-0.dzcdn.net/x.mp3");
  });

  const many = Array.from({ length: ROWS_PER_PART * 2 + 17 }, (_, i) => ({
    ...apple,
    trackId: String(1_000_000 + i),
  }));
  const wire = (docs: unknown) => JSON.parse(JSON.stringify(docs)) as unknown[];

  it("encodes a whole catalogue much smaller than the objects it replaced", () => {
    const compact = JSON.stringify(encodeCatalog(many, 7)).length;
    const verbose = JSON.stringify(many).length;
    expect(compact).toBeLessThan(verbose * 0.7);
  });

  it("splits into parts and joins them back in order, losing nothing", () => {
    const docs = encodeCatalog(many, 7);
    expect(docs.length).toBe(3);
    expect(docs.every((d) => d.parts === 3)).toBe(true);
    // arrival order doesn't matter
    const joined = joinParts(wire([docs[2], docs[0], docs[1]]));
    expect(joined?.version).toBe(7);
    expect(joined?.tracks).toEqual(many);
  });

  it("still makes one part for an empty catalogue", () => {
    const docs = encodeCatalog([], 4);
    expect(docs).toHaveLength(1);
    expect(joinParts(wire(docs))).toEqual({ version: 4, tracks: [] });
  });

  it("never splices two versions or a partial set together", () => {
    const v7 = encodeCatalog(many, 7);
    const v8 = encodeCatalog(many, 8);
    expect(joinParts(wire([v7[0], v8[1], v7[2]]))).toBeNull(); // a build landed mid-download
    expect(joinParts(wire([v7[0], v7[2]]))).toBeNull(); // a part missing
    expect(joinParts(wire([v7[0], v7[0], v7[2]]))).toBeNull(); // a part twice
  });

  it("refuses a document from a format it doesn't know", () => {
    expect(decodePart({ f: CATALOG_FORMAT + 1, v: 3, part: 0, parts: 1, rows: [] })).toBeNull();
    expect(decodePart(null)).toBeNull();
    expect(decodePart({ f: CATALOG_FORMAT, v: "3", part: 0, parts: 1, rows: [] })).toBeNull();
    expect(decodePart({ f: CATALOG_FORMAT, v: 3, rows: [] })).toBeNull();
  });
});

describe("when a client fetches the catalogue", () => {
  it("uses its cache and waits while the version is unknown", () => {
    expect(catalogAction(12, undefined)).toBe("use-cache");
    expect(catalogAction(null, undefined)).toBe("wait");
    // 0 = no file built on the server yet — never fetch a 503
    expect(catalogAction(null, 0)).toBe("wait");
    expect(catalogAction(12, 0)).toBe("use-cache");
  });

  it("downloads nothing on a warm start at the current version", () => {
    expect(catalogAction(12, 12)).toBe("use-cache");
  });

  it("fetches when the server moved on, or when it has nothing cached", () => {
    expect(catalogAction(12, 13)).toBe("fetch");
    expect(catalogAction(null, 13)).toBe("fetch");
  });

  it("builds the versioned URL the server caches forever", () => {
    expect(catalogUrl("https://x.convex.site/", 13, 2)).toBe("https://x.convex.site/catalog?v=13&part=2");
  });
});

describe("fetching the parts", () => {
  const docs = encodeCatalog(
    Array.from({ length: ROWS_PER_PART + 5 }, (_, i) => ({ ...apple, trackId: String(9_000_000 + i) })),
    21,
  );
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const partOf = (url: string) => Number(new URL(url).searchParams.get("part"));

  it("fetches every part and joins them", async () => {
    const seen: string[] = [];
    const got = await fetchCatalog("https://x.convex.site", { v: 21, parts: 2 }, (url) => {
      seen.push(url);
      return ok(JSON.parse(JSON.stringify(docs[partOf(url)])));
    });
    expect(got.version).toBe(21);
    expect(got.tracks).toHaveLength(ROWS_PER_PART + 5);
    expect(seen.sort()).toEqual([
      "https://x.convex.site/catalog?v=21&part=0",
      "https://x.convex.site/catalog?v=21&part=1",
    ]);
  });

  it("abandons a stalled request and retries it, instead of waiting minutes", async () => {
    let calls = 0;
    const got = await fetchCatalog(
      "https://x.convex.site",
      { v: 21, parts: 2 },
      (url, init) => {
        calls++;
        // part 1's first request hangs until it's aborted — a stalled connection
        if (partOf(url) === 1 && !url.includes("retry")) {
          return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        }
        return ok(JSON.parse(JSON.stringify(docs[partOf(url)])));
      },
      [30, 30, 30],
    );
    expect(got.tracks).toHaveLength(ROWS_PER_PART + 5);
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt rather than hanging forever", async () => {
    await expect(
      fetchCatalog("https://x.convex.site", { v: 21, parts: 1 }, () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) }), [5, 5]),
    ).rejects.toThrow();
  });
});
