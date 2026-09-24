/**
 * Which backend a production build talks to, decided by the repo.
 *
 * The URLs used to come only from the host's build variables. When the
 * self-hosted backend went down, moving to Convex Cloud meant editing settings
 * on a server nobody could reach from here — and a push would have kept
 * building against the dead one. The backend is public configuration that
 * belongs with the code, so a production build takes it from the committed
 * `.env.production`, over anything the host still has set.
 *
 * Development builds are untouched: `.env.local` and the shell still decide.
 */
export const BACKEND_KEYS = ["VITE_CONVEX_URL", "VITE_CONVEX_SITE_URL"];

/** KEY=value lines; `#` comments and blank lines ignored, quotes stripped. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * The backend variables to force for this build, or an empty object.
 * Only the backend keys are pinned; everything else stays the host's call.
 */
export function pinnedBackend(mode, committed) {
  if (mode !== "production") return {};
  const out = {};
  for (const key of BACKEND_KEYS) if (committed[key]) out[key] = committed[key];
  return out;
}
