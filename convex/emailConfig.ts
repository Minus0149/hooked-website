/**
 * Outgoing mail settings, read from the deployment's environment.
 *
 * Mail goes out through our own mailcow server (MX, SPF, DKIM and DMARC for
 * hookedcue.com all point at it), so this is plain authenticated SMTP rather
 * than a sending API. Set on the deployment with `npx convex env set`:
 *
 *   SMTP_HOST  mail.naravirtual.ai
 *   SMTP_PORT  465 (implicit TLS) or 587 (STARTTLS); 465 if unset
 *   SMTP_USER  the mailbox, e.g. noreply@hookedcue.com
 *   SMTP_PASS  that mailbox's password
 *   SMTP_FROM  optional display sender; defaults to "hookedcue <SMTP_USER>"
 *
 * Kept out of the "use node" sender so it can be unit-tested and read from the
 * default runtime, where the auth callbacks decide whether to send at all.
 */

export type SmtpSettings = {
  host: string;
  port: number;
  /** implicit TLS from the first byte (465); otherwise STARTTLS is required */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export type SmtpVerdict =
  | { ok: true; settings: SmtpSettings }
  | { ok: false; missing: string[] };

const REQUIRED = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"] as const;

export function smtpSettings(env: Record<string, string | undefined>): SmtpVerdict {
  const get = (k: string) => (env[k] ?? "").trim();
  const missing: string[] = REQUIRED.filter((k) => !get(k));

  const rawPort = get("SMTP_PORT");
  const port = rawPort ? Number(rawPort) : 465;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) missing.push("SMTP_PORT (a port number)");

  const user = get("SMTP_USER");
  if (user && !user.includes("@")) missing.push("SMTP_USER (a full mailbox address)");

  const from = get("SMTP_FROM") || (user ? `hookedcue <${user}>` : "");
  if (get("SMTP_FROM") && !from.includes("@")) missing.push("SMTP_FROM (must contain an address)");

  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    settings: { host: get("SMTP_HOST"), port, secure: port === 465, user, pass: get("SMTP_PASS"), from },
  };
}

/** A plain-text part for the same message — some clients and filters want one. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2: $1")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
