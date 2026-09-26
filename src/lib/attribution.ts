/**
 * Apple's terms for iTunes Search API content (performance-partners.apple.com/
 * search-api): a song preview must carry the line "provided courtesy of
 * iTunes", sit next to a link to that item in Apple's store, and be streamed
 * only. Creator uploads and Deezer previews are not Apple's content, so they
 * get neither the credit nor a claim that they are. Notes and sources:
 * docs/ITUNES-ATTRIBUTION.md.
 *
 * Mirrored in mobile/src/lib/attribution.ts: the rule is legal, not visual,
 * and both apps must apply it identically.
 */

export const ITUNES_CREDIT = "provided courtesy of iTunes";

/** The standing credit on Settings → Data & privacy, word for word in both apps. */
export const APPLE_CREDIT_NOTE =
  "Song previews and artwork are provided courtesy of iTunes and stream straight from Apple. hookedcue isn’t affiliated with Apple.";

type Creditable = { id: string; previewUrl?: string };

/**
 * The Apple store id behind a track, or null when the preview isn't Apple's.
 * Chart tracks carry the bare numeric id; playlist imports matched on iTunes
 * are "imp:itunes:<id>"; creator uploads are "own:…" and Deezer matches
 * "imp:deezer:…".
 */
export function itunesId(track: Creditable): string | null {
  if (/^\d+$/.test(track.id)) return track.id;
  const imported = /^imp:itunes:(\d+)$/.exec(track.id);
  return imported ? imported[1] : null;
}

/** Does playing this track's preview oblige us to credit iTunes? */
export function needsItunesCredit(track: Creditable): boolean {
  if (itunesId(track)) return true;
  // an id shape we don't know, but audio served from Apple's preview CDN
  return /(^|\.)itunes\.apple\.com\/|(^|\.)mzstatic\.com\//.test(track.previewUrl ?? "");
}

/** Where the full song lives on Apple Music: the item itself when we know it. */
export function appleMusicUrl(track: Creditable & { title: string; artist: string }): string {
  const id = itunesId(track);
  if (id) return `https://music.apple.com/us/song/${id}`;
  return `https://music.apple.com/us/search?term=${encodeURIComponent(`${track.title} ${track.artist}`)}`;
}
