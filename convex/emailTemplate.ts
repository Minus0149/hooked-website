/**
 * The one look every hookedcue email shares.
 *
 * Email clients are not browsers: no stylesheets, no web fonts to rely on,
 * images blocked until the reader allows them, and Outlook still lays out with
 * tables. So this is a table with inline styles, the wordmark is live text
 * (it reads even with images off), and the only image is the app icon, sent
 * inside the email as an inline attachment so no inbox blocks it.
 * Dark, like the app: #08080c page, #13131b card, pink #ff3d71 button.
 *
 * Everything a caller passes is escaped here, including the reader's own email
 * address — it is user input and it lands inside HTML.
 */

import { EMAIL_LOGO_CID } from "./emailLogo";

/** The logo travels inside the email (convex/emailLogo.ts), so no inbox blocks it. */
export const EMAIL_ICON_SRC = `cid:${EMAIL_LOGO_CID}`;
const SITE = "https://hookedcue.com";

export type EmailContent = {
  /** the grey line inbox lists show after the subject */
  preheader: string;
  heading: string;
  /** paragraphs of plain text; **double asterisks** mark a bold span */
  paragraphs: string[];
  button: { label: string; url: string };
  /** small print under the button, e.g. when the link expires */
  note?: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only real web links go in a button — never javascript: or data: */
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : SITE;
}

const bold = (s: string) =>
  escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f4f2ee;">$1</strong>');

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export function renderEmail(c: EmailContent): string {
  const url = safeUrl(c.button.url);
  const paras = c.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font:400 16px/1.55 ${FONT};color:#b9b7c2;">${bold(p)}</p>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(c.heading)}</title></head>
<body bgcolor="#08080c" style="margin:0;padding:0;background:#08080c;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#08080c;">${escapeHtml(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#08080c" style="background:#08080c;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:12px;"><img src="${EMAIL_ICON_SRC}" width="44" height="44" alt="hookedcue" style="display:block;border:0;border-radius:11px;"></td>
<td style="font:800 24px/1 ${FONT};letter-spacing:-0.5px;color:#f4f2ee;">hookedcue<span style="color:#ff3d71;">.</span></td>
</tr></table>
</td></tr>
<tr><td bgcolor="#13131b" style="background:#13131b;border:1px solid #23232e;border-radius:20px;padding:32px 28px;">
<h1 style="margin:0 0 16px;font:700 24px/1.25 ${FONT};letter-spacing:-0.3px;color:#f4f2ee;">${escapeHtml(c.heading)}</h1>
${paras}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td bgcolor="#ff3d71" style="border-radius:999px;background:#ff3d71;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font:700 16px/1 ${FONT};color:#0b0b10;text-decoration:none;border-radius:999px;">${escapeHtml(c.button.label)}</a></td>
</tr></table>
${c.note ? `<p style="margin:0 0 12px;font:400 13px/1.5 ${FONT};color:#8e8c99;">${escapeHtml(c.note)}</p>` : ""}
<p style="margin:0;font:400 12px/1.5 ${FONT};color:#6f6d7a;">Button not working? Paste this into your browser:<br><a href="${escapeHtml(url)}" style="color:#ff7aa0;word-break:break-all;">${escapeHtml(url)}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${FONT};color:#6f6d7a;">
hookedcue — every song starts at its hook.<br>
<a href="${SITE}" style="color:#8e8c99;">hookedcue.com</a> · <a href="${SITE}/privacy" style="color:#8e8c99;">privacy</a> · questions? <a href="mailto:hello@hookedcue.com" style="color:#8e8c99;">hello@hookedcue.com</a>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Sign-up confirmation. */
export function verifyEmail(email: string, url: string): { subject: string; html: string } {
  return {
    subject: "confirm your email for hookedcue",
    html: renderEmail({
      preheader: "One tap and you're in.",
      heading: "Confirm your email",
      paragraphs: [
        `You're one tap from hookedcue. Confirm **${email}** so we know this inbox is yours.`,
        "Every song starts at its hook — skip, save, or ask for more like it.",
      ],
      button: { label: "Confirm my email", url },
      note: "The link works for 24 hours. If you didn't sign up, ignore this — nothing happens.",
    }),
  };
}

/** Password reset. */
export function resetEmail(email: string, url: string): { subject: string; html: string } {
  return {
    subject: "reset your hookedcue password",
    html: renderEmail({
      preheader: "Choose a new password.",
      heading: "Reset your password",
      paragraphs: [`Someone (hopefully you) asked to reset the password for **${email}**.`],
      button: { label: "Choose a new password", url },
      note: "The link works once and expires in an hour. If it wasn't you, ignore this and your password stays as it was.",
    }),
  };
}

/** Approved for the beta: the only way in is this link — accounts are invite-only. */
export function inviteEmail(name: string, url: string): { subject: string; html: string } {
  const first = name.trim().split(/\s+/)[0] || "there";
  return {
    subject: "you're in — welcome to the hookedcue beta",
    html: renderEmail({
      preheader: "Your spot in the beta is ready.",
      heading: `You're in, ${first}.`,
      paragraphs: [
        "Your spot in the hookedcue beta is ready. Create your account with this email address and your library starts filling from the first swipe.",
        "Every song starts at its hook — skip, save, or ask for more like it.",
      ],
      button: { label: "Create my account", url },
      note: "This invite is for this email address only. If you weren't expecting it, you can ignore it.",
    }),
  };
}
