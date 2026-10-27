import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { serverMessage } from "../src/lib/serverError";

describe("serverMessage: what a backend refusal says to the listener", () => {
  it("reads a ConvexError's payload, which is all production lets through", () => {
    // shape the convex client builds on a prod deployment
    const prod = Object.assign(new Error("[Request ID: 45a2e82e0fb4383e] Server Error"), { data: "EMAIL_UNVERIFIED" });
    expect(serverMessage(prod)).toBe("EMAIL_UNVERIFIED");
    expect(serverMessage(new ConvexError("That invite link doesn't work any more"))).toBe(
      "That invite link doesn't work any more",
    );
    expect(serverMessage(Object.assign(new Error("x"), { data: { message: "Too fast" } }))).toBe("Too fast");
  });

  it("reads dev deployments' message text", () => {
    expect(
      serverMessage(new Error("[Request ID: 5e6e] Server Error\nUncaught ConvexError: ACCESS_PENDING\n    at handler (../convex/library.ts:77:35)")),
    ).toBe("ACCESS_PENDING");
    expect(serverMessage(new Error("[Request ID: 1] Server Error\nUncaught Error: Requires users.manage\n  at x"))).toBe(
      "Requires users.manage",
    );
  });

  it("falls back instead of showing 'Server Error'", () => {
    expect(serverMessage(new Error("[Request ID: 2e87] Server Error"), "Couldn't save")).toBe("Couldn't save");
    expect(serverMessage(undefined, "nope")).toBe("nope");
    expect(serverMessage(new Error("Network down"))).toBe("Network down");
  });
});

describe("the server's refusals survive production", () => {
  it("no Convex function throws a plain Error (prod would redact it to 'Server Error')", () => {
    const offenders: string[] = [];
    for (const f of readdirSync("convex").filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(`convex/${f}`, "utf8");
      if (/throw new Error\(/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("the client reads access-gate codes through serverMessage, not err.message", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/serverMessage\(err/);
    expect(app).not.toMatch(/err instanceof Error \? err\.message/);
  });
});
