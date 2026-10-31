import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { knownSongIds, requireSong, resolveSong } from "../convex/songs";
import catalogJson from "../src/data/catalog.json";

/**
 * The server, not the client, says what a song is called and where its
 * artwork and preview live (convex/songs.ts). A client used to be able to
 * save or share any title, artwork or preview link under a real song's id.
 */
type Row = Record<string, unknown> & { trackId: string };
function fakeCtx(rows: Row[]) {
  return {
    db: {
      query: () => ({
        withIndex: (_: string, f: (q: { eq: (k: string, v: string) => unknown }) => unknown) => {
          let want = "";
          f({ eq: (_k, v) => ((want = v), null) });
          return { first: async () => rows.find((r) => r.trackId === want) ?? null };
        },
      }),
    },
    storage: { getUrl: async (id: string) => `https://deploy.convex.cloud/api/storage/${id}` },
  } as never;
}

const real: Row = {
  trackId: "1640463908",
  title: "Delilah (pull me out of this)",
  artist: "Fred again..",
  album: "Actual Life 3",
  artwork: "https://is1-ssl.mzstatic.com/x/600x600bb.jpg",
  previewUrl: "https://audio-ssl.itunes.apple.com/p.m4a",
  durationMs: 250702,
  genre: "electronic",
  accent: "#FF3D71",
};

describe("songs are resolved from the id alone", () => {
  it("uses the stored row, whatever the client said", async () => {
    const t = await requireSong(fakeCtx([real]), " 1640463908 ");
    expect(t.title).toBe(real.title);
    expect(t.artwork).toBe(real.artwork);
    expect(t.previewUrl).toBe(real.previewUrl);
  });

  it("a creator upload without a preview plays from its stored audio", async () => {
    const own = { ...real, trackId: "own:u1:abc", previewUrl: "", audioStorageId: "kg2" };
    const found = await resolveSong(fakeCtx([own]), "own:u1:abc");
    expect(found?.track.previewUrl).toBe("https://deploy.convex.cloud/api/storage/kg2");
  });

  it("falls back to the bundled first deck", async () => {
    const first = (catalogJson as { id: string; title: string }[])[0];
    const found = await resolveSong(fakeCtx([]), first.id);
    expect(found?.track.title).toBe(first.title);
  });

  it("refuses an id that is nowhere", async () => {
    await expect(requireSong(fakeCtx([real]), "made-up-id")).rejects.toThrow(/isn't in the catalogue/);
    expect(await resolveSong(fakeCtx([]), "")).toBeNull();
  });

  it("a song an admin, a takedown or an unpublished upload hid can't be shared or added; curation's hides can", async () => {
    const takedown = { ...real, hidden: true };
    await expect(requireSong(fakeCtx([takedown]), real.trackId)).rejects.toThrow();
    // the swipe log may still answer a card dealt before the hide
    expect((await requireSong(fakeCtx([takedown]), real.trackId, { allowHidden: true })).title).toBe(real.title);
    const stale = { ...real, hidden: true, hiddenBy: "curation" };
    expect((await requireSong(fakeCtx([stale]), real.trackId)).title).toBe(real.title);
  });

  it("rooms keep only songs that exist and aren't withheld", async () => {
    const ids = await knownSongIds(fakeCtx([real, { ...real, trackId: "gone", hidden: true }]), [real.trackId, "gone", "fake"]);
    expect(ids).toEqual([real.trackId]);
  });
});

describe("every write that took a song from the client resolves it instead", () => {
  const src = (f: string) => readFileSync(resolve(__dirname, "..", "convex", f), "utf8");
  const body = (f: string, name: string) => {
    const s = src(f);
    const start = s.indexOf(`export const ${name} = `);
    const next = s.indexOf("\nexport ", start + 1);
    return s.slice(start, next < 0 ? undefined : next);
  };

  it("recordSwipe stores the catalogue's copy, and nothing for an unknown id", () => {
    const swipe = body("library.ts", "recordSwipe");
    expect(swipe).toMatch(/const found = await resolveSong\(ctx, track\.trackId\);\s*if \(!found\) return;\s*const safeTrack = found\.track;/);
    expect(swipe).not.toMatch(/cleanTrack\(/);
  });

  it("shareToFollowers and addToPlaylist refuse what isn't in the catalogue", () => {
    expect(body("social.ts", "shareToFollowers")).toMatch(/await requireSong\(ctx, track\.trackId\)/);
    expect(body("social.ts", "addToPlaylist")).toMatch(/await requireSong\(ctx, track\.trackId\)/);
    expect(src("social.ts")).not.toMatch(/cleanTrack\(/);
  });

  it("createRoom keeps only real songs", () => {
    expect(body("social.ts", "createRoom")).toMatch(/await knownSongIds\(ctx, wanted\)/);
  });
});
