import { describe, expect, it } from "vitest";
import { profileCheck } from "../src/lib/authGate";

/**
 * A new account used to get no profile until a reload: the profile was created
 * the moment Better Auth had a session, before Convex had the token. The mobile
 * copy is held identical by mobile/scripts/check-mirrors.mjs.
 */
describe("when a new listener's profile gets created", () => {
  it("waits for the backend to hold the token, not just the session", () => {
    expect(profileCheck(true, false)).toBe("waiting");
    expect(profileCheck(true, true)).toBe("ready");
  });

  it("resets when signed out, whatever the backend thinks", () => {
    expect(profileCheck(false, true)).toBe("signed-out");
    expect(profileCheck(false, false)).toBe("signed-out");
  });
});
