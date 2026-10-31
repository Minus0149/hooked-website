import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES, UPLOAD_FRESH_MS, audioUploadProblem } from "../convex/creatorRules";

const now = 1_800_000_000_000;
const file = (extra: Partial<{ contentType: string; size: number; _creationTime: number }> = {}) => ({
  contentType: "audio/mpeg",
  size: 8 * 1024 * 1024,
  _creationTime: now - 5_000,
  ...extra,
});

// attachAudio took any storage id: a page or an SVG served from the deployment,
// a file of any size, or another track's audio (which the next replacement on
// the attacker's track then deleted).
describe("a creator can only attach their own fresh audio upload", () => {
  it("accepts a fresh audio file", () => {
    expect(audioUploadProblem(file(), now)).toBeNull();
    expect(audioUploadProblem(file({ contentType: "audio/x-m4a" }), now)).toBeNull();
    expect(audioUploadProblem(file({ contentType: "Audio/WAV" }), now)).toBeNull();
  });

  it("refuses a storage id with no file behind it", () => {
    expect(audioUploadProblem(null, now)).toMatch(/didn't arrive/);
  });

  it("refuses anything that isn't audio", () => {
    for (const contentType of ["text/html", "image/svg+xml", "application/octet-stream", ""]) {
      expect(audioUploadProblem(file({ contentType }), now), contentType).toMatch(/isn't audio/);
    }
    expect(audioUploadProblem({ size: 10, _creationTime: now }, now)).toMatch(/isn't audio/);
  });

  it("refuses a file over the size cap", () => {
    expect(audioUploadProblem(file({ size: MAX_AUDIO_BYTES }), now)).toBeNull();
    expect(audioUploadProblem(file({ size: MAX_AUDIO_BYTES + 1 }), now)).toMatch(/too big/);
  });

  it("refuses an old file: an existing track's audio or an ad's artwork isn't this upload", () => {
    expect(audioUploadProblem(file({ _creationTime: now - UPLOAD_FRESH_MS - 1 }), now)).toMatch(/too old/);
  });

  it("attachAudio checks the _storage row before it deletes or patches anything", () => {
    const src = readFileSync(resolve(__dirname, "..", "convex", "creators.ts"), "utf8");
    const start = src.indexOf("export const attachAudio = ");
    const body = src.slice(start, src.indexOf("\nexport ", start + 1));
    const check = body.indexOf("audioUploadProblem(");
    expect(body).toMatch(/ctx\.db\.system\.get\(storageId\)/);
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf("ctx.storage.delete(track.audioStorageId)"));
    expect(check).toBeLessThan(body.indexOf("ctx.db.patch(track._id"));
  });
});
