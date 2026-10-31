import { secureCode } from "./secureRandom";

/**
 * The one-time code in an invite email (convex/access.ts sendInvite).
 *
 * An approved address used to be enough to create the account, and signing up
 * proves nothing about owning the address. Whoever typed an invited email
 * first chose the password; when the real owner clicked the confirmation link
 * that arrived in their inbox, the stranger's account became verified and
 * usable. The code only ever reaches the inbox, so creating the account now
 * needs something only the inbox owner has.
 *
 * Only a hash is stored. It is salted with the request's id and peppered with
 * the deployment's auth secret, so a copy of the table alone can't be turned
 * back into codes (eight characters is a small space to search offline).
 * Pure: no Convex imports, so tests run it directly.
 */

/** No 0/O or 1/I: the code is read off a phone screen and typed by hand. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
/**
 * How many outstanding codes a request keeps: the invite, the reminder and a
 * reissue each mint one, and any of them works until one is used.
 */
export const INVITE_CODES_KEPT = 3;

/** A fresh code, e.g. "K7QM4XRP". */
export function newInviteCode(): string {
  return secureCode(INVITE_CODE_LENGTH, INVITE_CODE_ALPHABET);
}

/** As printed in the email: two groups of four, "K7QM-4XRP". */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** What someone typed, as the code it stands for: case, spaces and dashes don't matter. */
export function cleanInviteCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.slice(0, 64).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The stored form of a code for one access request (hex SHA-256). */
export async function inviteCodeHash(requestId: string, code: string, pepper: string): Promise<string> {
  const input = new TextEncoder().encode(`hookedcue-invite\u0000${pepper}\u0000${requestId}\u0000${cleanInviteCode(code)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string compare (http.ts has the same one for its secrets):
 * `a !== b` leaks how much matched through timing.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether the typed code is one of the request's outstanding ones. Every hash is compared. */
export async function inviteCodeMatches(
  requestId: string,
  code: string,
  hashes: readonly string[],
  pepper: string,
): Promise<boolean> {
  const clean = cleanInviteCode(code);
  if (!clean || hashes.length === 0) return false;
  const typed = await inviteCodeHash(requestId, clean, pepper);
  let found = false;
  for (const h of hashes) found = safeEqual(h, typed) || found;
  return found;
}

/** The outstanding hashes after a new one is minted: newest kept, oldest dropped. */
export function withNewHash(hashes: readonly string[] | undefined, hash: string): string[] {
  return [...(hashes ?? []), hash].slice(-INVITE_CODES_KEPT);
}

export type InviteVerdict = "ok" | "missing" | "wrong" | "used" | "limited";

/**
 * What the sign-up form shows for each refusal. The phone builds from before
 * the code existed have no box for it and show the server's words as they
 * are, so "missing" tells them where else to go. None of these may contain
 * "already exists", "too many" or "approved yet": the forms rewrite those
 * (lib/authForms.ts friendlyAuthError, isNotApproved).
 */
export const INVITE_CODE_MESSAGES: Record<Exclude<InviteVerdict, "ok">, string> = {
  missing:
    "Creating an account needs the invite code from your invite email. Open the link in that email, or type the code in the invite code box (update the HookedCue app if you don't see one).",
  wrong: "This invite code doesn't match. Use the code from your invite email.",
  used: "This invite code has already been used to create an account. Sign in instead, or reset your password.",
  limited: "That's a lot of wrong codes for this email. Wait an hour, then use the code from your invite email.",
};
