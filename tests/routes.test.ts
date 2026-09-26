import { describe, expect, it } from "vitest";
import { pathForView, pathFromLegacyHash, routeFor } from "../src/lib/routes";

/** Clean URLs (no "#"), and every old #/ link still landing where it meant to. */
describe("routes", () => {
  it("reads the app's screens from plain paths", () => {
    expect(routeFor("/")).toEqual({ kind: "app", view: "home" });
    expect(routeFor("/profile")).toEqual({ kind: "app", view: "profile" });
    expect(routeFor("/settings/data/")).toEqual({ kind: "app", view: "settings:data" });
    expect(routeFor("/library/pl:k57Ab")).toEqual({ kind: "app", view: "library:pl:k57Ab" });
    expect(routeFor("/admin")).toEqual({ kind: "admin" });
    expect(routeFor("/creator")).toEqual({ kind: "creator" });
    expect(routeFor("/nope")).toEqual({ kind: "notfound" });
  });

  it("carries the invite email and the reset token", () => {
    expect(routeFor("/join", "?email=ada%40gmail.com")).toEqual({ kind: "join", email: "ada@gmail.com" });
    expect(routeFor("/reset-password", "?token=abc")).toEqual({ kind: "reset", token: "abc", error: null });
  });

  it("round-trips every view to a path", () => {
    for (const v of ["home", "discover", "profile", "settings", "settings:data", "library:pl:k57Ab"] as const) {
      const r = routeFor(pathForView(v));
      expect(r).toEqual({ kind: "app", view: v });
    }
  });

  it("rewrites old #/ links, including reset links", () => {
    expect(pathFromLegacyHash("#/profile")).toBe("/profile");
    expect(pathFromLegacyHash("#/")).toBe("/");
    expect(pathFromLegacyHash("#/admin")).toBe("/admin");
    expect(pathFromLegacyHash("#/?token=abc")).toBe("/reset-password?token=abc");
    expect(pathFromLegacyHash("")).toBeNull();
    expect(pathFromLegacyHash("#section")).toBeNull();
  });
});
