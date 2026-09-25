import { describe, expect, it } from "vitest";
import { htmlToText, smtpSettings } from "../convex/emailConfig";

/**
 * Verification and reset links are the only way a tester gets in, and they go
 * out through our own mail server. The failure worth guarding is the silent
 * one: a half-set environment that "sends" nothing and says so nowhere.
 */
describe("smtpSettings", () => {
  const full = {
    SMTP_HOST: "mail.naravirtual.ai",
    SMTP_USER: "noreply@hookedcue.com",
    SMTP_PASS: "x",
  };

  it("defaults to implicit TLS on 465 and a branded sender", () => {
    const v = smtpSettings(full);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.settings.port).toBe(465);
    expect(v.settings.secure).toBe(true);
    expect(v.settings.from).toBe("hookedcue <noreply@hookedcue.com>");
  });

  it("uses STARTTLS on 587", () => {
    const v = smtpSettings({ ...full, SMTP_PORT: "587" });
    expect(v.ok && v.settings.secure).toBe(false);
    expect(v.ok && v.settings.port).toBe(587);
  });

  it("names every missing setting instead of failing quietly", () => {
    const v = smtpSettings({ SMTP_HOST: "mail.naravirtual.ai" });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.missing).toEqual(expect.arrayContaining(["SMTP_USER", "SMTP_PASS"]));
  });

  it("rejects a bad port and a user that isn't a mailbox", () => {
    const v = smtpSettings({ ...full, SMTP_PORT: "smtp", SMTP_USER: "noreply" });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.missing.join(" ")).toMatch(/SMTP_PORT/);
    expect(v.missing.join(" ")).toMatch(/SMTP_USER/);
  });

  it("keeps an explicit sender", () => {
    const v = smtpSettings({ ...full, SMTP_FROM: "hookedcue <hello@hookedcue.com>" });
    expect(v.ok && v.settings.from).toBe("hookedcue <hello@hookedcue.com>");
  });
});

describe("htmlToText", () => {
  it("keeps the link a plain-text reader needs", () => {
    const text = htmlToText('<p>Confirm <b>a@b.c</b>.</p><p><a href="https://x.y/v?t=1">Confirm my email</a> now.</p>');
    expect(text).toContain("Confirm a@b.c.");
    expect(text).toContain("Confirm my email: https://x.y/v?t=1");
    expect(text).not.toMatch(/<[^>]+>/);
  });
});
