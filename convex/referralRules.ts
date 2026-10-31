/**
 * Invite-a-friend rules, pure so they can be tested without a database.
 *
 * Every approved listener has one personal code. A friend who applies through
 * it (hookedcue.com/beta?ref=CODE, or the app's apply form with ?ref=CODE) is
 * approved on the spot — they skip the waitlist — until the inviter has used
 * up their allowance (runtime config `referralCap`, 3 by default, 0 = off).
 * Everything past that joins the normal queue like anyone else.
 */

import { sameEmail } from "./emailIdentity";

export const REFERRAL_DEFAULT_CAP = 3;
/**
 * Someone let in through a friend's invite gets no invites of their own until
 * their account is this old. Without it one invite fanned out: each friend
 * approved on the spot could approve three more at once, and so on, so a
 * single code (or one person with many inboxes) skipped the whole waitlist.
 */
export const REFERRED_INVITE_WAIT_DAYS = 7;
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
  /** when the inviter's own invites unlock (referralLockedUntil); absent or null = already open */
  inviterLockedUntil?: number | null;
  now?: number;
};

/** A request approved through someone's invite, rather than by the queue or an operator. */
export function cameByInvite(row: { referredBy?: string | null; decidedBy?: string | null } | null): boolean {
  if (!row) return false;
  return !!row.referredBy || (row.decidedBy ?? "").startsWith("referral:");
}

/** When an account's own invites start working, or null if they already do. */
export function referralLockedUntil(profileCreatedAt: number, cameIn: boolean, now: number): number | null {
  if (!cameIn) return null;
  const until = profileCreatedAt + REFERRED_INVITE_WAIT_DAYS * 86_400_000;
  return now < until ? until : null;
}

/**
 * approve — skip the waitlist, counts against the inviter
 * ignore  — handle like any other application
 */
export function referralDecision(r: ReferralInput): "approve" | "ignore" {
  if (r.cap <= 0 || !r.inviter) return "ignore";
  // the same inbox under another spelling (j.doe+1@gmail.com) is still yourself
  if (sameEmail(r.applicantEmail, r.inviter.email)) return "ignore";
  if (r.inviterLockedUntil && (r.now ?? Date.now()) < r.inviterLockedUntil) return "ignore";
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
