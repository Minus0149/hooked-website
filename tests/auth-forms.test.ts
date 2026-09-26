import { describe, expect, it } from "vitest";
import {
  AUTH_COPY,
  authProblem,
  friendlyAuthError,
  isNotApproved,
  resetPasswordProblem,
} from "../src/lib/authForms";
import { NOT_APPROVED_MESSAGE } from "../convex/access";

/**
 * The sign-in / invite / reset forms, identical in both apps. hookedcue is a
 * beta you apply for, so the form leads with signing in and turns the server's
 * "not approved" into an Apply button.
 */
describe("auth forms", () => {
  it("leads with signing in, not creating an account", () => {
    expect(AUTH_COPY.signin.submit).toBe("Sign in");
    expect(AUTH_COPY.apply).toMatch(/Apply/);
    expect(AUTH_COPY.haveInvite).toMatch(/invite/);
  });

  it("catches a bad email or missing password before sending", () => {
    expect(authProblem("signin", "ada@example", "pw")).toMatch(/email/);
    expect(authProblem("signin", "ada@example.com", "")).toMatch(/password/);
    expect(authProblem("join", "ada@example.com", "short")).toMatch(/8/);
    expect(authProblem("join", "ada@example.com", "long-enough")).toBeNull();
  });

  it("checks a new password is long enough and typed the same twice", () => {
    expect(resetPasswordProblem("short", "short")).toMatch(/8/);
    expect(resetPasswordProblem("long-enough", "long-enougH")).toMatch(/match/);
    expect(resetPasswordProblem("long-enough", "long-enough")).toBeNull();
  });

  it("recognises the server's not-approved refusal", () => {
    expect(isNotApproved(NOT_APPROVED_MESSAGE)).toBe(true);
    expect(isNotApproved("Invalid email or password")).toBe(false);
  });

  it("puts Better Auth's messages in the app's voice", () => {
    expect(friendlyAuthError("Invalid email or password")).toBe("That email and password don't match.");
    expect(friendlyAuthError("Too many requests. Please try again later.")).toMatch(/Wait a minute/);
    expect(friendlyAuthError(undefined)).toMatch(/Try again/);
  });
});
