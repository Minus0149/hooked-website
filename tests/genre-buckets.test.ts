import { describe, expect, it } from "vitest";
import { GENRES, tasteScore, EMPTY_TASTE } from "../src/data/taste";

/**
 * The onboarding / Sound & taste genre buckets (2026-10-20). Desi used to miss
 * Malayalam, Kannada, Marathi, Bengali and Gujarati — 300+ songs a listener who
 * picked Desi was never steered toward — and there was no bucket at all for
 * K-pop, Arabic, Afrobeats, devotional, soundtracks, jazz or classical.
 */
const picks = (id: string, genre: string) =>
  tasteScore({ genre }, { ...EMPTY_TASTE, genres: [id] }) > 0;

describe("genre buckets", () => {
  it("count every Indian language Apple files as a genre as Desi", () => {
    for (const g of ["malayalam", "kannada", "marathi", "bengali", "gujarati", "bhojpuri", "punjabi pop", "indian pop", "telugu", "urdu"]) {
      expect(picks("desi", g), g).toBe(true);
    }
  });

  it("have a home for the genres that had none", () => {
    expect(picks("kpop", "k-pop")).toBe(true);
    expect(picks("kpop", "j-pop")).toBe(true);
    expect(picks("arabic", "khaleeji")).toBe(true);
    expect(picks("arabic", "egyptian pop")).toBe(true);
    expect(picks("afro", "afro-beat")).toBe(true);
    expect(picks("afro", "afrobeats")).toBe(true);
    expect(picks("devotional", "sufi")).toBe(true);
    expect(picks("devotional", "christian")).toBe(true);
    expect(picks("soundtrack", "tv soundtrack")).toBe(true);
    expect(picks("jazz", "blues")).toBe(true);
    expect(picks("classical", "new age")).toBe(true);
    expect(picks("latin", "sertanejo")).toBe(true);
  });

  it("don't drag unrelated genres in", () => {
    expect(picks("jazz", "rock")).toBe(false);
    expect(picks("arabic", "bollywood")).toBe(false);
    expect(picks("classical", "hip-hop/rap")).toBe(false);
  });

  it("have unique ids and fit what setTaste stores", () => {
    const ids = GENRES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(24);
  });
});
