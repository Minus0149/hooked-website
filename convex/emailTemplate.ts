/**
 * The one look every HookedCue email shares.
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
import { formatInviteCode } from "./inviteCodes";

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
  /** A paragraph under the button, for whoever the steps don't fit. */
  after?: string;
  note?: string;
  /** numbered steps shown before the button, each a link (the button is the last step) */
  steps?: { label: string; detail?: string; url: string }[];
  /** a code to type, printed large under the button (the invite code) */
  code?: { label: string; value: string; detail?: string };
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

function stepsHtml(steps: EmailContent["steps"]): string {
  if (!steps || steps.length === 0) return "";
  const rows = steps
    .map(
      (st, i) => `<tr>
<td valign="top" style="width:30px;padding:0 0 14px;font:800 15px/1.4 ${FONT};color:#ff3d71;">${i + 1}.</td>
<td valign="top" style="padding:0 0 14px;font:400 15px/1.5 ${FONT};color:#b9b7c2;"><a href="${escapeHtml(safeUrl(st.url))}" style="color:#f4f2ee;font-weight:700;text-decoration:underline;">${escapeHtml(st.label)}</a>${st.detail ? `<br><span style="font-size:13px;color:#8e8c99;">${escapeHtml(st.detail)}</span>` : ""}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 6px;">${rows}</table>`;
}

/** Monospace and spaced out, so it reads letter by letter off a phone screen. */
function codeHtml(code: EmailContent["code"]): string {
  if (!code) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
<td bgcolor="#0b0b10" style="background:#0b0b10;border:1px solid #23232e;border-radius:14px;padding:14px 18px;">
<div style="font:700 11px/1.4 ${FONT};letter-spacing:1.5px;text-transform:uppercase;color:#8e8c99;">${escapeHtml(code.label)}</div>
<div style="font:700 26px/1.3 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace;letter-spacing:4px;color:#f4f2ee;">${escapeHtml(code.value)}</div>
${code.detail ? `<div style="font:400 13px/1.5 ${FONT};color:#8e8c99;">${escapeHtml(code.detail)}</div>` : ""}
</td></tr></table>`;
}

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
<td style="padding-right:12px;"><img src="${EMAIL_ICON_SRC}" width="44" height="44" alt="HookedCue" style="display:block;border:0;border-radius:11px;"></td>
<td style="font:800 24px/1 ${FONT};letter-spacing:-0.5px;color:#f4f2ee;">HookedCue<span style="color:#ff3d71;">.</span></td>
</tr></table>
</td></tr>
<tr><td bgcolor="#13131b" style="background:#13131b;border:1px solid #23232e;border-radius:20px;padding:32px 28px;">
<h1 style="margin:0 0 16px;font:700 24px/1.25 ${FONT};letter-spacing:-0.3px;color:#f4f2ee;">${escapeHtml(c.heading)}</h1>
${paras}
${stepsHtml(c.steps)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td bgcolor="#ff3d71" style="border-radius:999px;background:#ff3d71;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font:700 16px/1 ${FONT};color:#0b0b10;text-decoration:none;border-radius:999px;">${escapeHtml(c.button.label)}</a></td>
</tr></table>
${codeHtml(c.code)}
${c.after ? `<p style="margin:0 0 16px;font:400 15px/1.55 ${FONT};color:#b9b7c2;">${bold(c.after)}</p>` : ""}
${c.note ? `<p style="margin:0 0 12px;font:400 13px/1.5 ${FONT};color:#8e8c99;">${escapeHtml(c.note)}</p>` : ""}
<p style="margin:0;font:400 12px/1.5 ${FONT};color:#6f6d7a;">Button not working? Paste this into your browser:<br><a href="${escapeHtml(url)}" style="color:#ff7aa0;word-break:break-all;">${escapeHtml(url)}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${FONT};color:#6f6d7a;">
HookedCue — every song starts at its hook.<br>
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
    subject: "confirm your email for HookedCue",
    html: renderEmail({
      preheader: "One tap and you're in.",
      heading: "Confirm your email",
      paragraphs: [
        `You're one tap from HookedCue. Confirm **${email}** so we know this inbox is yours.`,
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
    subject: "reset your HookedCue password",
    html: renderEmail({
      preheader: "Choose a new password.",
      heading: "Reset your password",
      paragraphs: [`Someone (hopefully you) asked to reset the password for **${email}**.`],
      button: { label: "Choose a new password", url },
      note: "The link works once and expires in an hour. If it wasn't you, ignore this and your password stays as it was.",
    }),
  };
}

/** The Android closed test: Google only lets members of this group opt in. */
export const TESTER_GROUP_URL = "https://groups.google.com/g/hookedcue-beta";
/** Play's opt-in page for the closed test ("Become a tester", then install). */
export const PLAY_OPT_IN_URL = "https://play.google.com/apps/testing/com.minus.hookedcue";

/** The invite code box both invite emails carry: the link fills it in, the app asks for it. */
const inviteCodeBox = (code: string): EmailContent["code"] => ({
  label: "Your invite code",
  value: formatInviteCode(code),
  detail: "The button fills it in. In the Android app, type it in the invite code box. It works once, for this email only.",
});

/**
 * Approved for the beta: the only way in is this link — accounts are invite-only.
 * `reissued` is the one-off resend for invites mailed before they carried a
 * code (access:reissueInviteCodes).
 */
export function inviteEmail(
  name: string,
  url: string,
  code: string,
  opts: { reissued?: boolean } = {},
): { subject: string; html: string } {
  const first = name.trim().split(/\s+/)[0] || "there";
  const lead =
    "Your spot in the HookedCue beta is ready. Three quick steps on your Android phone, signed in to Google with the same Gmail you want to test with:";
  return {
    subject: opts.reissued ? "your HookedCue invite, now with your code" : "you're in — welcome to the HookedCue beta",
    html: renderEmail({
      preheader: opts.reissued
        ? "Creating your account now needs the code in this email."
        : "Your spot in the beta is ready — three quick steps.",
      heading: `You're in, ${first}.`,
      paragraphs: opts.reissued
        ? [
            "Creating a HookedCue account now needs a one-time invite code, so nobody else can sign up with your address. Yours is in this email; the earlier invite didn't have one, so use this one.",
            lead,
          ]
        : [lead],
      // there's no iPhone app yet, but the browser build is the whole app, so iPhone and computer users only need step 3
      after: "On an iPhone or a computer? Skip steps 1 and 2: tap step 3 and HookedCue runs in your browser at app.hookedcue.com, the whole app, same account.",
      steps: [
        { label: "Join the testers group", detail: "One tap — Google needs this before it shows you the app.", url: TESTER_GROUP_URL },
        { label: "Install HookedCue from Google Play", detail: "Tap “Become a tester”, then install.", url: PLAY_OPT_IN_URL },
      ],
      button: { label: "3. Create my account", url },
      code: inviteCodeBox(code),
      note: "This invite is for this email address only, so don't pass the code on. If you weren't expecting it, you can ignore it.",
    }),
  };
}

/** Approved a few days ago but never made an account: one nudge, never more (convex/access.ts remindUnjoined). */
export function inviteReminderEmail(name: string, url: string, code: string): { subject: string; html: string } {
  const first = name.trim().split(/\s+/)[0] || "there";
  return {
    subject: "your HookedCue invite is still waiting",
    html: renderEmail({
      preheader: "Your spot is saved. One tap to make your account.",
      heading: `Your spot is still here, ${first}.`,
      paragraphs: [
        "You were approved for the HookedCue beta a few days ago, but your account isn't made yet. It takes a minute: every song starts at its hook, so you'll know in seconds if you love it.",
      ],
      button: { label: "Create my account", url },
      code: inviteCodeBox(code),
      after: "On Android you can also install it from Google Play (the steps are in your first invite email). On an iPhone or a computer, the button above is all you need: it runs in your browser.",
      note: "This is the only reminder we'll send. If you'd rather not join, just ignore it.",
    }),
  };
}

const rupeesText = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const dateText = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/** A promotion request was approved: pay the approved quote within the window. */
export function promotionApprovedEmail(opts: {
  song: string;
  listeners: number;
  totalPaise: number;
  expiresAt: number;
  url: string;
  note?: string;
}): { subject: string; html: string } {
  const price = rupeesText(opts.totalPaise);
  const paragraphs = [
    `Your request to promote **${opts.song}** is approved: ${opts.listeners.toLocaleString("en-IN")} listeners for ${price}.`,
    `Pay from your creator dashboard by **${dateText(opts.expiresAt)}** and your song goes into the deck straight away. After that the approval lapses and you can ask again.`,
  ];
  if (opts.note) paragraphs.push(`A note from us: ${opts.note}`);
  return {
    subject: `Your promotion is approved — pay ${price} to start`,
    html: renderEmail({
      preheader: `${opts.song}: approved for ${opts.listeners.toLocaleString("en-IN")} listeners.`,
      heading: "Your promotion is approved",
      paragraphs,
      button: { label: `Pay ${price} and start`, url: opts.url },
      note: "Promoted songs are labelled Promoted. Listeners we don't reach in 30 days are refunded.",
    }),
  };
}

/** A promotion request was turned down, with the reason. */
export function promotionRejectedEmail(opts: { song: string; reason: string; url: string }): { subject: string; html: string } {
  return {
    subject: `About your promotion request for ${opts.song}`,
    html: renderEmail({
      preheader: "We couldn't approve this one.",
      heading: "We couldn't approve this request",
      paragraphs: [
        `Thanks for asking to promote **${opts.song}**. We can't approve it as it stands.`,
        `The reason: ${opts.reason}`,
        "Nothing was charged. You're welcome to change what's needed and ask again.",
      ],
      button: { label: "Open your creator dashboard", url: opts.url },
      note: "Questions? Reply to hello@hookedcue.com.",
    }),
  };
}

/** An artist's song is this week's indie hook — unpaid, chosen by us. */
export function featuredEmail(opts: { song: string; week: string; blurb: string; shareUrl: string }): {
  subject: string;
  html: string;
} {
  const from = new Date(`${opts.week}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "UTC" });
  return {
    subject: `${opts.song} is this week's indie hook on HookedCue`,
    html: renderEmail({
      preheader: "Your song is at the top of everyone's Home this week.",
      heading: "You're this week's indie hook",
      paragraphs: [
        `We picked **${opts.song}** as the indie hook of the week. From ${from}, it's at the top of Home for everyone on HookedCue, starting at its hook.`,
        `What we wrote about it: ${opts.blurb}`,
        "Share it — the link below opens a page made for Instagram stories.",
      ],
      button: { label: "See it and share it", url: opts.shareUrl },
      note: "This is a free feature, not a paid promotion — no action needed.",
    }),
  };
}
