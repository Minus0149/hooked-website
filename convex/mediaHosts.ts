/**
 * Which artwork and preview addresses a song may carry.
 *
 * A creator typed their track's artwork (and could send a preview) link, and
 * any https address went through: every listener's device then loaded it when
 * the card came up, and hookedcue.com's share-image renderer fetched it from
 * its own server. That is a tracker in every deck and a way to make the
 * landing request an address of the creator's choosing. Only the hosts the
 * catalogue really uses are accepted:
 *   - Apple's artwork CDN (*.mzstatic.com) and previews (*.itunes.apple.com)
 *   - Deezer's CDN (*.dzcdn.net), which imported tracks use
 *   - cdn.hookedcue.com
 *   - this deployment's own file storage (<CONVEX_CLOUD_URL>/api/storage/…)
 *
 * The landing applies the same rule before it fetches anything
 * (landing/src/lib/mediaHosts.ts). Pure, no Convex imports
 * (tests/media-hosts.test.ts).
 */

const SUFFIXES = [".mzstatic.com", ".itunes.apple.com", ".dzcdn.net"];
const EXACT = ["cdn.hookedcue.com"];

function hostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The URL, normalised, when a song may carry it; otherwise null. `storageOrigin`
 * is this deployment's own URL (process.env.CONVEX_CLOUD_URL), whose
 * /api/storage/ paths are the app's own uploads.
 */
export function safeMediaUrl(raw: unknown, storageOrigin?: string): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // no http, no user:pass@ tricks, no odd ports
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (EXACT.includes(host) || SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length)) return url.toString();
  const own = hostOf(storageOrigin);
  if (own && host === own && url.pathname.startsWith("/api/storage/")) return url.toString();
  return null;
}

/** What a creator is told when a link isn't on the list. */
export function mediaHostMessage(field: "Artwork" | "Preview"): string {
  return field === "Artwork"
    ? "Artwork has to be an Apple Music image link (…mzstatic.com), or leave it blank."
    : "A preview link has to be an Apple preview (…itunes.apple.com); upload the audio instead.";
}
