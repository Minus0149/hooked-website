/**
 * Growth links: share a song at its hook, the story images behind it, the
 * weekly recap image, and invite codes arriving in a URL.
 *
 * Mirrored in mobile/src/lib/growth.ts (checked by mobile/scripts/check-mirrors.mjs):
 * both apps must build the same links, or a share from the phone opens a
 * different page than one from the web.
 *
 * The share pages and images live on the landing site (hookedcue.com), which
 * renders them server-side with proper Open Graph previews. Audio is never
 * part of a share — the page streams Apple's preview (or a creator's own
 * upload) the same way the app does.
 */

export const SHARE_SITE = "https://hookedcue.com";

const base = (site: string) => site.replace(/\/+$/, "");

/** hookedcue.com/s/<trackId>[?h=<hook>] — the link people actually paste. */
export function songShareUrl(trackId: string, hookIndex = 0, site = SHARE_SITE): string {
  const h = Number.isInteger(hookIndex) && hookIndex > 0 ? `?h=${hookIndex}` : "";
  return `${base(site)}/s/${encodeURIComponent(trackId)}${h}`;
}

/** The 1080x1920 story image for a song, for Instagram/WhatsApp stories. */
export function songStoryUrl(trackId: string, hookIndex = 0, site = SHARE_SITE): string {
  const h = Number.isInteger(hookIndex) && hookIndex > 0 ? `?h=${hookIndex}` : "";
  return `${base(site)}/s/${encodeURIComponent(trackId)}/story${h}`;
}

export function shareText(title: string, artist: string): string {
  return `${title} — ${artist}. hear the hook on HookedCue`;
}

export type RecapImage = {
  firstName: string | null;
  cards: number;
  saves: number;
  newArtists: number;
  saveRate: number;
  topMoods: string[];
  topArtist: string | null;
  /** end of the week, ms */
  until: number;
};

/**
 * The recap story image. Only the numbers the listener chose to share travel
 * in the URL — no account id, nothing that points back to them.
 */
export function recapStoryUrl(r: RecapImage, site = SHARE_SITE): string {
  const q = new URLSearchParams();
  if (r.firstName) q.set("n", r.firstName.slice(0, 20));
  q.set("c", String(Math.max(0, Math.round(r.cards))));
  q.set("s", String(Math.max(0, Math.round(r.saves))));
  q.set("a", String(Math.max(0, Math.round(r.newArtists))));
  q.set("r", String(Math.round(Math.min(Math.max(r.saveRate, 0), 1) * 100)));
  if (r.topMoods.length) q.set("m", r.topMoods.slice(0, 3).join(","));
  if (r.topArtist) q.set("t", r.topArtist.slice(0, 40));
  q.set("w", new Date(r.until).toISOString().slice(0, 10));
  return `${base(site)}/r/story?${q.toString()}`;
}

/** "Your week in hooks" shows on Sundays and Mondays, in the listener's own time zone. */
export function isRecapDay(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 1;
}

/** Where a pending invite code waits between landing on the app and applying. */
export const REF_STORAGE_KEY = "hooked.ref.v1";

/** An invite code from a URL's query string, or null. Codes are 7 characters. */
export function refFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("ref");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[2-9A-HJ-NP-Z]{7}$/.test(code) ? code : null;
}
