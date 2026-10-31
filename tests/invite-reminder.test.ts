import { describe, expect, it } from "vitest";
import { needsReminder, REMIND_AFTER_DAYS, REMIND_WITHIN_DAYS } from "../convex/access";
import { inviteReminderEmail } from "../convex/emailTemplate";

/**
 * The "your invite is still waiting" email (convex/access.ts remindUnjoined):
 * one nudge, only to approved + invited people who still have no account,
 * 3–30 days after approval. Never twice, never to someone already in.
 */
const DAY = 86_400_000;
const now = Date.parse("2026-11-10T05:07:00Z");
const row = (daysAgo: number, extra: Record<string, unknown> = {}) => ({
  status: "approved",
  invited: true,
  decidedAt: new Date(now - daysAgo * DAY).toISOString(),
  ...extra,
});

describe("needsReminder", () => {
  it("nudges someone approved 3+ days ago with no account", () => {
    expect(needsReminder(row(REMIND_AFTER_DAYS), false, now)).toBe(true);
    expect(needsReminder(row(10), false, now)).toBe(true);
  });

  it("waits until the third day", () => {
    expect(needsReminder(row(2.9), false, now)).toBe(false);
  });

  it("never reminds twice", () => {
    expect(needsReminder(row(5, { remindedAt: "2026-11-08T05:07:00Z" }), false, now)).toBe(false);
  });

  it("skips anyone who already made an account", () => {
    expect(needsReminder(row(5), true, now)).toBe(false);
  });

  it("leaves old approvals, pending, rejected and never-invited rows alone", () => {
    expect(needsReminder(row(REMIND_WITHIN_DAYS + 1), false, now)).toBe(false);
    expect(needsReminder(row(5, { status: "pending" }), false, now)).toBe(false);
    expect(needsReminder(row(5, { status: "rejected" }), false, now)).toBe(false);
    expect(needsReminder(row(5, { invited: false }), false, now)).toBe(false);
    expect(needsReminder({ status: "approved", invited: true }, false, now)).toBe(false);
  });
});

describe("inviteReminderEmail", () => {
  it("links back to account creation and says it's the only reminder", () => {
    const { subject, html } = inviteReminderEmail("Ada Lovelace", "https://app.hookedcue.com/join?email=ada%40gmail.com");
    expect(subject).toContain("still waiting");
    expect(html).toContain("Your spot is still here, Ada.");
    expect(html).toContain('href="https://app.hookedcue.com/join?email=ada%40gmail.com"');
    expect(html).toContain("the only reminder");
    expect(html).toContain("iPhone");
  });
});
