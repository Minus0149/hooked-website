import { describe, expect, it } from "vitest";
import { escapeHtml, inviteEmail, renderEmail, resetEmail, verifyEmail } from "../convex/emailTemplate";
import { EMAIL_LOGO_PNG_BASE64 } from "../convex/emailLogo";
import { htmlToText } from "../convex/emailConfig";

/**
 * The sign-up and reset emails are the first thing a tester sees from us, and
 * the reader's own address is user input that lands inside HTML.
 */
describe("hookedcue emails", () => {
  it("carries the brand, the icon and a working button", () => {
    const { subject, html } = verifyEmail("ada@example.com", "https://x.convex.site/verify?token=abc");
    expect(subject).toBe("confirm your email for hookedcue");
    expect(html).toContain("hookedcue<span");
    expect(html).toContain('src="cid:hookedcue-logo"');
    expect(html).toContain('href="https://x.convex.site/verify?token=abc"');
    expect(html).toContain("<strong");
  });

  it("escapes whatever the reader typed as their address", () => {
    const { html } = resetEmail('"><script>alert(1)</script>@x.co', "https://x.co/r");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never puts a non-web link behind the button", () => {
    const html = renderEmail({
      preheader: "p",
      heading: "h",
      paragraphs: ["x"],
      button: { label: "go", url: "javascript:alert(1)" },
    });
    expect(html).not.toContain("javascript:");
  });

  it("still reads as plain text, link included", () => {
    const { html } = verifyEmail("ada@example.com", "https://x.co/v?t=1");
    const text = htmlToText(html);
    expect(text).toContain("Confirm my email: https://x.co/v?t=1");
    expect(text).toContain("ada@example.com");
  });

  it("escapes the five HTML specials", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("invites by first name and links to account creation", () => {
    const { subject, html } = inviteEmail("Ada Lovelace", "https://app.hookedcue.com/profile?signup=1");
    expect(subject).toContain("hookedcue beta");
    expect(html).toContain("You&#39;re in, Ada."); // the apostrophe is escaped like everything else
    expect(html).toContain('href="https://app.hookedcue.com/profile?signup=1"');
  });

  it("ships a real PNG as the inline logo", () => {
    const png = Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(1000);
  });
});
