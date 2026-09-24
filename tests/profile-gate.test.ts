import { describe, expect, it } from "vitest";
import { profileGate } from "../convex/library";

/**
 * Who gets a profile. Signing up never proved you owned the email, so an
 * approved invite could be claimed by whoever typed the invited address first
 * — and the admin allowlist worked the same way. Admin is no longer granted
 * here at all; this is only the invite rule.
 */
describe("who gets in on first sign-in", () => {
  it("needs an approved invite AND a confirmed inbox", () => {
    expect(profileGate("approved", true)).toBe("create");
    expect(profileGate("approved", false)).toBe("EMAIL_UNVERIFIED");
  });

  it("never asks someone to confirm an email they weren't invited with", () => {
    expect(profileGate(null, false)).toBe("ACCESS_NOT_REQUESTED");
    expect(profileGate("pending", false)).toBe("ACCESS_PENDING");
    expect(profileGate("rejected", true)).toBe("ACCESS_REJECTED");
  });

  it("treats an unknown status as still pending, not as approved", () => {
    expect(profileGate("invited", true)).toBe("ACCESS_PENDING");
  });
});
