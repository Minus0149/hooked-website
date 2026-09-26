import { describe, expect, it } from "vitest";
import { joinUrl, NOT_APPROVED_MESSAGE, signupAllowed } from "../convex/access";

/**
 * hookedcue is a beta you apply for (Minus, 2026-09-26: "I don't want them to
 * create an account, it's a beta sign-up form"). The sign-up hook lets an
 * email create an account only once its application is approved.
 */
describe("invite-only accounts", () => {
  it("lets only an approved email create an account", () => {
    expect(signupAllowed("approved")).toBe(true);
    for (const s of ["pending", "rejected", null, undefined]) expect(signupAllowed(s)).toBe(false);
  });

  it("tells a refused person what to do next", () => {
    expect(NOT_APPROVED_MESSAGE).toMatch(/apply for the beta/);
  });

  it("links the invite to the create-account screen with the email filled in", () => {
    expect(joinUrl("https://app.hookedcue.com/", "ada+beta@gmail.com")).toBe(
      "https://app.hookedcue.com/join?email=ada%2Bbeta%40gmail.com",
    );
  });
});
