import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDEXABLE, PRIVATE, applyRobots, robotsFor } from "../src/lib/robots";
import { pathForView, routeFor } from "../src/lib/routes";

describe("which addresses search engines may index", () => {
  it("only the landing", () => {
    expect(robotsFor("/")).toBe(INDEXABLE);
    for (const p of ["/discover", "/profile", "/settings/data", "/library/pl:abc", "/people", "/u/minus", "/u/minus/mutual",
      "/playlist/abc", "/join-playlist/ABCD2345", "/together/ABCD2345", "/join", "/reset-password", "/admin", "/creator", "/search"]) {
      expect(robotsFor(p)).toBe(PRIVATE);
    }
  });

  it("the Caddyfile's X-Robots-Tag covers every app route the router knows", () => {
    const caddy = readFileSync("Caddyfile", "utf8");
    const line = /@private path ([^\n]+)/.exec(caddy)![1].split(/\s+/);
    const covered = (path: string) => line.some((pat) => (pat.endsWith("*") ? path.startsWith(pat.slice(0, -1)) : path === pat));
    const views = ["discover", "profile", "search", "settings", "settings:data", "library:pl:x", "people", "user:minus", "mutual:minus", "playlist:x", "invite:ABCD2345", "room:ABCD2345"] as const;
    for (const v of views) {
      const path = pathForView(v as never);
      expect(routeFor(path).kind).not.toBe("notfound");
      expect(covered(path), path).toBe(true);
    }
    for (const p of ["/join", "/reset-password", "/admin", "/creator"]) expect(covered(p), p).toBe(true);
    expect(covered("/")).toBe(false);
    expect(caddy).toMatch(/header @private X-Robots-Tag "noindex, follow"/);
  });

  it("rewrites the page's meta tag", () => {
    const meta = { content: INDEXABLE, setAttribute(_: string, v: string) { this.content = v; } };
    const doc = { querySelector: () => meta } as unknown as Document;
    applyRobots(doc, "/settings");
    expect(meta.content).toBe(PRIVATE);
    applyRobots(doc, "/");
    expect(meta.content).toBe(INDEXABLE);
  });

  it("index.html starts indexable and lists only the landing in the sitemap", () => {
    expect(readFileSync("index.html", "utf8")).toContain(`<meta name="robots" content="${INDEXABLE}" />`);
    const sitemap = readFileSync("public/sitemap.xml", "utf8");
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual(["https://app.hookedcue.com/"]);
    expect(readFileSync("public/robots.txt", "utf8")).toContain("Sitemap: https://app.hookedcue.com/sitemap.xml");
  });
});
