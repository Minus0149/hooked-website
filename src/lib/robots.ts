/**
 * Only the landing ("/") is for search engines. Every other address is one
 * person's screen (their library, settings, a room, someone's profile) or a
 * link that needs an account, and a search result pointing there is a dead
 * end. The Caddyfile sends X-Robots-Tag: noindex for the same paths (that is
 * what crawlers read first); this keeps the page's own meta tag in step when
 * the app navigates without a reload.
 */
export const INDEXABLE = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
export const PRIVATE = "noindex, follow";

export function robotsFor(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/" ? INDEXABLE : PRIVATE;
}

/** Set the page's robots meta for the current address. */
export function applyRobots(doc: Document = document, pathname = window.location.pathname): void {
  const meta = doc.querySelector('meta[name="robots"]');
  if (meta) meta.setAttribute("content", robotsFor(pathname));
}
