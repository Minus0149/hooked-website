/**
 * Who may post to /access/apply.
 *
 * Browsers always send an Origin, and a page on another site must not be able
 * to post applications through a visitor's browser — so a browser request is
 * only accepted from the web app's own origin. The phone app is not a browser:
 * a native fetch sends no Origin at all, and refusing that locked the Android
 * app out of its own application form.
 *
 * Accepting a missing Origin opens nothing new. A script could always call this
 * route by setting whatever Origin it liked; what actually protects it is the
 * per-IP, per-email and global rate limits, the honeypot and the fill-time trap,
 * and those apply to every caller.
 */
export function applyOriginAllowed(origin: string | null, appOrigin: string): boolean {
  if (origin === null || origin === "") return true;
  return origin === appOrigin;
}
