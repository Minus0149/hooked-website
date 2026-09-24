import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * public/frame-guard.js hid the app only when redirecting the top window threw,
 * and Chrome blocks that redirect without throwing — so a framed copy stayed
 * visible and clickable. Run the real script against fake windows.
 */
const src = readFileSync(new URL("../public/frame-guard.js", import.meta.url), "utf8");

function run(framed: "no" | "yes" | "unreadable", topNavigation: "blocked-silently" | "throws") {
  const style: { display?: string } = {};
  let navigatedTo: unknown = null;
  const self: Record<string, unknown> = { location: "https://app.hookedcue.com/" };
  let top: Record<string, unknown> = self;
  if (framed !== "no") {
    top = {};
    Object.defineProperty(top, "location", {
      set(v) {
        if (topNavigation === "throws") throw new Error("SecurityError");
        navigatedTo = v; // Chrome: logs, doesn't throw, doesn't navigate
      },
    });
  }
  const win: Record<string, unknown> = { self };
  Object.defineProperty(win, "top", {
    get() {
      if (framed === "unreadable") throw new Error("cross-origin");
      return top;
    },
  });
  new Function("window", "document", src)(win, { documentElement: { style } });
  return { hidden: style.display === "none", navigatedTo };
}

describe("refusing to run inside someone else's page", () => {
  it("leaves the app alone as the top page", () => {
    expect(run("no", "throws").hidden).toBe(false);
  });

  it("hides even when the browser blocks the break-out silently", () => {
    const r = run("yes", "blocked-silently");
    expect(r.hidden).toBe(true);
    expect(r.navigatedTo).toBe("https://app.hookedcue.com/");
  });

  it("hides when the break-out throws, and when top can't be read", () => {
    expect(run("yes", "throws").hidden).toBe(true);
    expect(run("unreadable", "throws").hidden).toBe(true);
  });
});
