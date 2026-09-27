import { describe, expect, it } from "vitest";
import { featuredEmail, promotionApprovedEmail, promotionRejectedEmail } from "../convex/emailTemplate";
import { htmlToText } from "../convex/emailConfig";

/**
 * The approval email is how an artist learns what they'll pay and by when,
 * and the rejection email is the only place they hear why. Both carry text an
 * artist or admin typed, so both must escape it.
 */
describe("promotion emails", () => {
  const expiresAt = Date.UTC(2026, 9, 4, 12, 0, 0);

  it("tell the artist the approved price, reach, deadline and where to pay", () => {
    const { subject, html } = promotionApprovedEmail({
      song: "Movin' To The Sun",
      listeners: 500,
      totalPaise: 20_000,
      expiresAt,
      url: "https://app.hookedcue.com/creator",
    });
    expect(subject).toBe("Your promotion is approved — pay ₹200 to start");
    const text = htmlToText(html);
    expect(text).toContain("500 listeners for ₹200");
    expect(text).toContain("4 October 2026");
    expect(html).toContain('href="https://app.hookedcue.com/creator"');
    expect(html).toContain("cid:hookedcue-logo");
  });

  it("include the admin's note, escaped", () => {
    const { html } = promotionApprovedEmail({
      song: "x",
      listeners: 100,
      totalPaise: 5_000,
      expiresAt,
      url: "https://app.hookedcue.com/creator",
      note: "<b>nice</b> track",
    });
    expect(html).toContain("&lt;b&gt;nice&lt;/b&gt; track");
  });

  it("give the reason for a rejection and say nothing was charged", () => {
    const { subject, html } = promotionRejectedEmail({
      song: "<script>",
      reason: "The audio clips at the hook.",
      url: "https://app.hookedcue.com/creator",
    });
    expect(subject).toContain("<script>"); // a subject is plain text, not HTML
    expect(html).not.toContain("<script>");
    const text = htmlToText(html);
    expect(text).toContain("The reason: The audio clips at the hook.");
    expect(text).toContain("Nothing was charged.");
  });

  it("tell an artist their song is the indie hook of the week, with a share link", () => {
    const { subject, html } = featuredEmail({
      song: "Self Aware",
      week: "2026-09-28",
      blurb: "A <b>bright</b> hook.",
      shareUrl: "https://hookedcue.com/indie-hook",
    });
    expect(subject).toBe("Self Aware is this week's indie hook on HookedCue");
    expect(htmlToText(html)).toContain("From 28 September");
    expect(html).toContain("&lt;b&gt;bright&lt;/b&gt;");
    expect(html).toContain('href="https://hookedcue.com/indie-hook"');
    expect(htmlToText(html)).toContain("not a paid promotion");
  });
});
