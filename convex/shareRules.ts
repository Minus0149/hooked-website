/**
 * The bundled catalogue (src/data/catalog.json) is the first deck every new
 * visitor gets, before the real one downloads — and those songs aren't all in
 * the tracks table. A share from that deck still has to open, so share:track
 * falls back to the same file the app ships. Baked songs carry no stored hook
 * windows; the page plays their preview from the start, as the app does.
 */

export type BakedTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork: string;
  previewUrl: string;
  durationMs?: number;
  genre?: string;
  accent?: string;
};

export type SharedTrack = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  genre: string;
  accent: string;
  previewUrl: string;
  audioUrl: string | null;
  durationMs: number;
  hooks: { startMs: number; durationMs: number; label: string | null }[];
};

export function fromBaked(list: readonly BakedTrack[], trackId: string): SharedTrack | null {
  const t = list.find((x) => x.id === trackId);
  if (!t || !t.previewUrl) return null;
  return {
    trackId: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album ?? "",
    artwork: t.artwork,
    genre: t.genre ?? "",
    accent: t.accent ?? "#FF3D71",
    previewUrl: t.previewUrl,
    audioUrl: null,
    durationMs: t.durationMs ?? 30_000,
    hooks: [],
  };
}
