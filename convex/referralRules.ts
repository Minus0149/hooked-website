/**
 * Invite-a-friend rules, pure so they can be tested without a database.
 *
 * Every approved listener has one personal code. A friend who applies through
 * it (hookedcue.com/beta?ref=CODE, or the app's apply form with ?ref=CODE) is
 * approved on the spot — they skip the waitlist — until the inviter has used
 * up their allowance (runtime config `referralCap`, 3 by default, 0 = off).
 * Everything past that joins the normal queue like anyone else.
 */

export const REFERRAL_DEFAULT_CAP = 3;
/** Successful invites (friends who actually made an account) that earn the badge. */
export const FOUNDING_LISTENER_AT = 2;

/** Crockford-ish base32 without look-alikes (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 7;

export function makeCode(random: () => number): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return out;
}

/** Normalise whatever arrived in a URL or form into a code, or null. */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!ALPHABET.includes(ch)) return null;
  return code;
}

export type ReferralInput = {
  cap: number;
  /** null when the code doesn't exist */
  inviter: { userId: string; email: string } | null;
  applicantEmail: string;
  /** status of the applicant's existing request, or null for a new applicant */
  existingStatus: "pending" | "approved" | "rejected" | null;
  /** approvals this inviter has already used */
  used: number;
};

/**
 * approve — skip the waitlist, counts against the inviter
 * ignore  — handle like any other application
 */
export function referralDecision(r: ReferralInput): "approve" | "ignore" {
  if (r.cap <= 0 || !r.inviter) return "ignore";
  if (r.applicantEmail.trim().toLowerCase() === r.inviter.email.trim().toLowerCase()) return "ignore";
  // a decision already made stands: an invite never un-rejects anyone, and an
  // approved person doesn't need (or use up) an invite
  if (r.existingStatus === "rejected" || r.existingStatus === "approved") return "ignore";
  if (r.used >= r.cap) return "ignore";
  return "approve";
}

export function isFoundingListener(joined: number): boolean {
  return joined >= FOUNDING_LISTENER_AT;
}

/** The link an inviter shares. The landing's beta form carries the code through. */
export function inviteLink(site: string, code: string): string {
  return `${site.replace(/\/+$/, "")}/beta?ref=${encodeURIComponent(code)}`;
}
