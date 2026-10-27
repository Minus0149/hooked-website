import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAQ_LINK, LANDING_FACTS, LANDING_FAQ, songCountLabel } from "../src/lib/landingCopy";
import { TOUR_COPY } from "../src/lib/tourCopy";

const html = readFileSync("index.html", "utf8");
const all = [...LANDING_FACTS, FAQ_LINK, ...LANDING_FAQ.flatMap((f) => [f.q, f.a])].join("\n");

describe("the first screen's facts and FAQ", () => {
  it("answer the objections people raise before trying it", () => {
    const qs = LANDING_FAQ.map((f) => f.q.toLowerCase()).join(" | ");
    expect(qs).toContain("free");
    expect(qs).toContain("which songs");
    expect(qs).toContain("30-second");
    expect(qs).toContain("account");
  });

  it("make no claim the app can't back: no user counts, ratings, testimonials or superlatives", () => {
    expect(all).not.toMatch(/\b\d[\d,]*\+?\s*(users|listeners|people|downloads|installs|reviews)\b/i);
    expect(all).not.toMatch(/★|stars?\b|rated|rating|testimonial|#1|best app|millions?/i);
    // the facts that are load-bearing stay true to the code
    expect(all).toMatch(/five free swipes/); // App.tsx FREE_SWIPES = 5
    expect(all).toMatch(/invite-only/i); // library.profileGate
    expect(all).toMatch(/closed testing/); // no public Play listing yet
    expect(all).toMatch(/no iPhone app/);
  });

  it("show a song count only from the live catalogue, rounded down", () => {
    expect(songCountLabel(6377)).toBe("6,300+ songs");
    expect(songCountLabel(100)).toBeNull();
    expect(songCountLabel(Number.NaN)).toBeNull();
  });
});

describe("index.html paints the same welcome step before the app loads", () => {
  it("carries the tour's words and the facts, verbatim", () => {
    expect(html).toContain(`${TOUR_COPY.welcome.headline.lead} <em>${TOUR_COPY.welcome.headline.accent}</em>`);
    expect(html).toContain(TOUR_COPY.welcome.copy);
    expect(html).toContain(LANDING_FACTS.map((f) => `<li>${f}</li>`).join(""));
    expect(html).toContain(FAQ_LINK);
    expect(html).toContain(`>${TOUR_COPY.start}<`);
    expect(html).toContain(`>${TOUR_COPY.skip}<`);
  });

  it("shows it only for a first visit to '/', flagged by a same-origin script (no inline JS under the CSP)", () => {
    expect(html).toMatch(/html:not\(\[data-boot="tour"\]\) #boot-tour \{ display: none; \}/);
    expect(html).toContain('<script src="/boot.js"></script>');
    const boot = readFileSync("public/boot.js", "utf8");
    expect(boot).toContain('location.pathname === "/"');
    expect(boot).toContain('"hooked.onboarded.v1"'); // App.tsx ONBOARD_KEY
    expect(readFileSync("src/App.tsx", "utf8")).toContain('const ONBOARD_KEY = "hooked.onboarded.v1";');
  });

  it("the React step skips its entrance fade so the swap doesn't blink", () => {
    const tour = readFileSync("src/components/Onboarding.tsx", "utf8");
    expect(tour).toContain('<AnimatePresence mode="wait" initial={false}>');
  });
});

describe("SEO head", () => {
  it("has inline JSON-LD (Google ignores ld+json with a src) and nothing false in it", () => {
    expect(html).not.toMatch(/application\/ld\+json"\s+src=/);
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]);
    expect(ld["@type"]).toBe("WebApplication");
    expect(ld.name).toBe("HookedCue");
    expect(ld.offers.price).toBe("0");
    expect(ld).not.toHaveProperty("aggregateRating");
    expect(ld).not.toHaveProperty("review");
    expect(JSON.stringify(ld)).not.toMatch(/Android|iOS/); // not publicly listed yet
  });

  it("has a title, description, canonical and a real OG/Twitter image", () => {
    const title = /<title>([^<]+)<\/title>/.exec(html)![1];
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toContain("HookedCue");
    const desc = /<meta name="description" content="([^"]+)"/.exec(html)![1];
    expect(desc.length).toBeGreaterThan(70);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(html).toContain('<link rel="canonical" href="https://app.hookedcue.com/" />');
    const img = /<meta property="og:image" content="https:\/\/app\.hookedcue\.com\/([^"]+)"/.exec(html)![1];
    const png = readFileSync(`public/${img}`);
    expect(png.readUInt32BE(16)).toBe(1200); // IHDR width
    expect(png.readUInt32BE(20)).toBe(630); // IHDR height
    expect(html).toContain(`<meta name="twitter:image" content="https://app.hookedcue.com/${img}" />`);
  });

  it("loads its fonts from this origin, not a render-blocking Google stylesheet", () => {
    expect(html).not.toContain("fonts.googleapis.com");
    expect(readFileSync("public/_headers", "utf8")).not.toContain("fonts.googleapis.com");
    const fonts = readFileSync("src/styles/fonts.css", "utf8");
    for (const [, file] of fonts.matchAll(/url\("\/fonts\/([^"]+)"\)/g)) {
      expect(readFileSync(`public/fonts/${file}`).length).toBeGreaterThan(1000);
    }
    for (const [, file] of html.matchAll(/rel="preload" href="\/fonts\/([^"]+)"/g)) {
      expect(fonts).toContain(`/fonts/${file}`);
    }
  });
});
