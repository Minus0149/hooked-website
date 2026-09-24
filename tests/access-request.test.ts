import { describe, expect, it } from "vitest";
import { detailFields, detailsPatch, nameFor } from "../convex/access";

describe("signing up with just an email", () => {
  it("keeps a real name", () => {
    expect(nameFor("Minus", "m@x.com")).toBe("Minus");
  });

  it("stands in the address's local part when no name is given", () => {
    expect(nameFor("", "night.owl@example.com")).toBe("night.owl");
    expect(nameFor(" ", "ab@example.com")).toBe("ab");
  });

  it("never stores an empty name", () => {
    expect(nameFor("", "a@example.com")).toBe("listener");
  });
});

describe("the optional second step", () => {
  const pending = { status: "pending" };

  it("fills details the first step left empty", () => {
    const patch = detailsPatch(
      pending,
      detailFields({ device: "Pixel 8a", genres: ["House", "soul"], androidVersion: "15" }),
    );
    expect(patch).toEqual({ device: "Pixel 8a", genres: ["house", "soul"], androidVersion: "15" });
  });

  it("never overwrites what is already there", () => {
    const patch = detailsPatch(
      { status: "pending", device: "Galaxy S23", genres: ["k-pop"] },
      detailFields({ device: "Pixel 8a", genres: ["house"], notes: "love it" }),
    );
    expect(patch).toEqual({ notes: "love it" });
  });

  it("can't touch a request that has been decided", () => {
    for (const status of ["approved", "rejected"]) {
      expect(detailsPatch({ status }, detailFields({ device: "Pixel 8a" }))).toEqual({});
    }
  });

  it("ignores empty values", () => {
    expect(detailsPatch(pending, detailFields({ device: "  ", genres: [], notes: "" }))).toEqual({});
  });
});
