"use node";

import nodemailer from "nodemailer";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { htmlToText, smtpSettings } from "./emailConfig";
import { EMAIL_LOGO_CID, EMAIL_LOGO_PNG_BASE64 } from "./emailLogo";

/**
 * Send one transactional email through our mailcow server over SMTP.
 *
 * A Node action because the default Convex runtime has no raw sockets. The
 * auth callbacks schedule this rather than awaiting it, so a slow or refused
 * mail server never holds up a sign-up or a reset request.
 */
export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  handler: async (_ctx, { to, subject, html }) => {
    const verdict = smtpSettings(process.env);
    if (!verdict.ok) {
      console.warn(`[email] not sent ("${subject}") — set ${verdict.missing.join(", ")}`);
      return { sent: false as const };
    }
    const s = verdict.settings;
    const transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      requireTLS: !s.secure,
      auth: { user: s.user, pass: s.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      // the logo rides inside the message (cid:), so it shows before "load images"
      const attachments = html.includes(`cid:${EMAIL_LOGO_CID}`)
        ? [{ filename: "hookedcue.png", content: Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64"), cid: EMAIL_LOGO_CID, contentType: "image/png" }]
        : [];
      const info = await transport.sendMail({ from: s.from, to, subject, html, text: htmlToText(html), attachments });
      console.log(`[email] sent "${subject}" (${info.messageId})`);
      return { sent: true as const };
    } catch (err) {
      console.error(`[email] "${subject}" failed:`, err instanceof Error ? err.message : err);
      return { sent: false as const };
    }
  },
});
