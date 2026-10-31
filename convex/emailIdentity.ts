import { DISPOSABLE_DOMAINS } from "./disposableDomains";

/**
 * Who an email address belongs to, for counting and comparing — never for
 * sending. Pure (no Convex imports) so tests/email-identity.test.ts runs it on
 * fixed inputs.
 *
 * Gmail ignores dots and anything after a "+", so j.doe+1@gmail.com,
 * jdoe+2@googlemail.com and JDoe@gmail.com are one inbox. Each used to be a
 * separate access request, a separate referral and a separate account: one
 * person could fill a friend's invite allowance, or invite themselves over
 * and over. The key folds them together. What the person typed is still what
 * we store and mail; the key is only what we look up and dedupe on.
 */

/** "+tag" is stripped on every domain; dots only where the provider ignores them. */
const DOTLESS_DOMAINS = new Set(["gmail.com"]);
const DOMAIN_ALIASES: Record<string, string> = { "googlemail.com": "gmail.com" };

/**
 * Full-width and other compatibility forms fold to plain letters first (NFKC),
 * so ｊｄｏｅ@ｇｍａｉｌ.ｃｏｍ is jdoe@gmail.com rather than a new person.
 */
const fold = (raw: string) => raw.normalize("NFKC").trim().toLowerCase();

export function emailDomain(raw: string): string {
  const email = fold(raw);
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).replace(/\.+$/, "");
}

export function emailKey(raw: string): string {
  const email = fold(raw);
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  let local = email.slice(0, at);
  const domain = DOMAIN_ALIASES[emailDomain(email)] ?? emailDomain(email);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (DOTLESS_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Two addresses that reach the same person. */
export function sameEmail(a: string, b: string): boolean {
  return emailKey(a) === emailKey(b);
}

/**
 * Temporary-inbox services the community list (disposableDomains.ts) misses.
 * Add here rather than editing the generated file.
 */
export const EXTRA_DISPOSABLE = ["temp-mail.io", "tempmail.com", "tempmail.net"];

const DISPOSABLE = new Set<string>([...DISPOSABLE_DOMAINS, ...EXTRA_DISPOSABLE]);

/**
 * A temporary inbox: the domain or any parent of it is on the list, so
 * abc.mailinator.com is caught along with mailinator.com. Offline on purpose —
 * no MX lookup, nothing sent anywhere on a signup.
 */
export function isDisposableEmail(raw: string): boolean {
  const parts = emailDomain(raw).split(".").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

export const DISPOSABLE_MESSAGE = "Please use a permanent email address. Temporary inboxes can't join HookedCue.";
