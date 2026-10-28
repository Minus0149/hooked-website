import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { HAS_MOBILE } from "./mobile-sibling";

/**
 * The phone app talks to the same Convex prod as the web app, and prod
 * redacts a thrown Error's message to "[Request ID: …] Server Error". The
 * phone matched ACCESS_PENDING / EMAIL_UNVERIFIED in err.message, so on prod a
 * new account that hadn't confirmed its email got the app with nothing
 * syncing instead of "check your inbox" (28 Oct 2026, mirrors web 4a555bf).
 */
const MOBILE_LIB = new URL("../../mobile/src/lib/serverError.ts", import.meta.url).href;
const { serverMessage } = HAS_MOBILE
  ? ((await import(/* @vite-ignore */ MOBILE_LIB)) as typeof import("../../mobile/src/lib/serverError"))
  : { serverMessage: (_e: unknown, f = "") => f };

const read = (path: string) => (HAS_MOBILE ? readFileSync(`../mobile/${path}`, "utf8") : "");

describe.skipIf(!HAS_MOBILE)("the phone reads backend refusals the way production sends them", () => {
  it("reads a ConvexError's payload, which is all production lets through", () => {
    const prod = Object.assign(new Error("[Request ID: 45a2e82e0fb4383e] Server Error"), { data: "EMAIL_UNVERIFIED" });
    expect(serverMessage(prod)).toBe("EMAIL_UNVERIFIED");
    expect(serverMessage(new ConvexError("ACCESS_PENDING"))).toBe("ACCESS_PENDING");
    expect(serverMessage(new ConvexError("That name is taken."), "x")).toBe("That name is taken.");
  });

  it("falls back to the caller's words instead of 'Server Error'", () => {
    expect(serverMessage(new Error("[Request ID: 2e87] Server Error"), "try again in a moment")).toBe(
      "try again in a moment",
    );
  });

  it("is the web's helper, byte for byte", () => {
    expect(read("src/lib/serverError.ts").replace(/\r\n/g, "\n")).toBe(
      readFileSync("src/lib/serverError.ts", "utf8").replace(/\r\n/g, "\n"),
    );
    expect(read("scripts/check-mirrors.mjs")).toContain('"lib/serverError.ts"');
  });

  it("decides the access gate from serverMessage, not err.message", () => {
    const app = read("App.tsx");
    const gate = app.slice(app.indexOf("void ensureProfile({})"), app.indexOf('setAccessState("unverified")'));
    expect(gate).toMatch(/serverMessage\(err/);
    expect(gate).toContain("EMAIL_UNVERIFIED");
    expect(gate).not.toMatch(/err\.message/);
  });

  it("no screen that shows a Convex refusal reads err.message any more", () => {
    for (const file of ["App.tsx", "src/components/ReportSong.tsx", "src/components/UsernameField.tsx"]) {
      const src = read(file);
      expect(src, file).toMatch(/serverMessage\(/);
      expect(src, file).not.toMatch(/(err|e) instanceof Error \? (err|e)\.message/);
    }
  });
});
