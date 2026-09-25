import { describe, expect, it } from "vitest";
import {
  MAX_ACCESS_GENRES,
  applyBody,
  emailLooksValid,
  stageAfterApply,
  toggleAccessGenre,
} from "../src/lib/accessApply";

/**
 * The invite application is the only door into the app for testers, on the web
 * and on the phone alike — both walls run this module, so an answer from the
 * server can't send someone to a different screen depending on the device.
 */
describe("stageAfterApply", () => {
  it("sends a new email on to the optional details", () => {
    expect(stageAfterApply({ ok: true, duplicate: false })).toBe("details");
  });
  it("sends someone already approved straight to sign in", () => {
    expect(stageAfterApply({ ok: true, duplicate: true, status: "approved" })).toBe("signin");
  });
  it("lets a pending applicant still add details", () => {
    expect(stageAfterApply({ ok: true, duplicate: true, status: "pending" })).toBe("details");
  });
  it("shows the settled answer to a rejected email", () => {
    expect(stageAfterApply({ ok: true, duplicate: true, status: "rejected" })).toBe("already");
  });
});

describe("emailLooksValid", () => {
  it("accepts an address and rejects obvious typos", () => {
    expect(emailLooksValid(" me@hookedcue.com ")).toBe(true);
    expect(emailLooksValid("me@hookedcue")).toBe(false);
    expect(emailLooksValid("me hookedcue.com")).toBe(false);
  });
});

describe("toggleAccessGenre", () => {
  it("adds, removes, and stops at the cap", () => {
    expect(toggleAccessGenre([], "house")).toEqual(["house"]);
    expect(toggleAccessGenre(["house"], "house")).toEqual([]);
    const full = Array.from({ length: MAX_ACCESS_GENRES }, (_, i) => `g${i}`);
    expect(toggleAccessGenre(full, "soul")).toBe(full);
  });
});

describe("applyBody", () => {
  it("trims, keeps the bot traps, and leaves blank details out", () => {
    const body = applyBody(
      { name: " Asha ", email: " a@b.co ", trap: "", startedAt: 42 },
      { device: "  ", notes: " loud ", genres: [] },
    );
    expect(body).toEqual({ name: "Asha", email: "a@b.co", website: "", startedAt: 42, notes: "loud" });
  });
});
