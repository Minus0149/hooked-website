/**
 * Usernames: the @handle a listener goes by.
 *
 * One set of rules for the server (convex/profiles.ts checks every write) and
 * both apps (which check as you type, so the answer arrives before the
 * round trip). Mirrored in mobile/src/lib/username.ts by check-mirrors.
 *
 * Lowercase only, so "@Minus" and "@minus" can never be two people. Letters,
 * digits, dots and underscores, 3–20 long, starting and ending on a letter or
 * digit — the shape people already know from Instagram.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * Names that would let someone pass as the app, its staff or a page of it.
 * Anything containing "hookedcue" is refused separately.
 */
const RESERVED = new Set([
  "admin", "administrator", "root", "system", "staff", "team", "official", "moderator", "mod",
  "support", "help", "hello", "contact", "privacy", "legal", "copyright", "security", "grievance",
  "noreply", "no.reply", "postmaster", "abuse", "billing", "payments", "promotions", "ads",
  "hooked", "hookedapp", "api", "www", "mail", "app", "cdn",
  "me", "you", "null", "undefined", "anonymous", "guest", "user", "username",
  "home", "discover", "search", "profile", "settings", "library", "creator", "creators", "artist",
  "artists", "join", "invite", "beta", "login", "signin", "signup", "logout",
]);

/** What a person typed, as it would be stored: no "@", no spaces, lowercase. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Why this (already normalized) name can't be used, or null if it can.
 * Messages are written to be shown as they are.
 */
export function usernameProblem(name: string): string | null {
  if (name.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!/^[a-z0-9._]+$/.test(name)) return "Only letters, numbers, dots and underscores.";
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) return "Start and end with a letter or number.";
  if (/[._]{2}/.test(name)) return "No two dots or underscores in a row.";
  if (/^[0-9._]+$/.test(name)) return "Include at least one letter.";
  if (RESERVED.has(name) || name.includes("hookedcue")) return "That name is reserved.";
  return null;
}
