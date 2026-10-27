import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every public Convex function either knows who is calling or is on the list
 * below with the reason it is open to anyone.
 *
 * A query or mutation exported with `query(` / `mutation(` / `action(` can be
 * called by any browser with the deployment URL, signed in or not. Adding one
 * without an identity check is how a private playlist or someone's prefs leak,
 * so a new open function has to be argued for here, not slipped in.
 */
const CONVEX = resolve(__dirname, "..", "convex");

/** Ways the codebase establishes (or refuses) the caller. */
const IDENTITY =
  /require(User|GatedUser|Permission|Admin|Seller|Creator)\(ctx|safeGetAuthUser\(ctx\)|getAuthUser\(ctx\)|getUserIdentity\(\)|getViewer\(ctx\)|viewerId\(ctx\)|viewerKey\(ctx/;

/** Open on purpose. Each needs its reason. */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "tracks.list": "the public catalogue every guest is dealt; explicit field list, hidden tracks dropped",
  "catalog.version": "which catalogue build to download; no user data",
  "share.track": "a shared song link must open for anyone; visible tracks only",
  "runtime.get": "client tuning knobs (free swipes, thresholds); no user data",
  "moods.crowd": "crowd mood tags, published only past a vote floor",
  "featured.current": "the public hook of the day",
  "featured.archive": "past hooks of the day",
  "ads.getConfig": "ad cadence settings the deck reads",
  "ads.nextAd": "an ad for a guest or listener; reads only frequency counters",
  "sponsoredDecks.live": "the live sponsored mood decks",
  "promotions.nextPromoted": "a promoted song card; delivery caps checked server-side",
  "promotions.confirmPayment": "authenticated by the Razorpay HMAC signature, not a session",
  "imports.importPlaylist": "authenticated by the per-run CSPRNG token beginImport issued to an approved creator",
  "social.invite": "the join screen's preview; the unguessable code is the key, closed once un-shared",
};

type Fn = { id: string; kind: string; body: string };

function publicFunctions(): Fn[] {
  const out: Fn[] = [];
  for (const file of readdirSync(CONVEX).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(resolve(CONVEX, file), "utf8");
    const mod = file.replace(/\.ts$/, "");
    for (const m of src.matchAll(/export const (\w+) = (query|mutation|action)\(/g)) {
      const start = m.index!;
      const next = src.indexOf("\nexport ", start + 1);
      out.push({ id: `${mod}.${m[1]}`, kind: m[2], body: src.slice(start, next < 0 ? undefined : next) });
    }
  }
  return out;
}

describe("public Convex functions know their caller", () => {
  const fns = publicFunctions();

  it("finds the functions", () => {
    expect(fns.length).toBeGreaterThan(120);
  });

  for (const fn of fns) {
    it(`${fn.kind} ${fn.id}`, () => {
      if (PUBLIC_BY_DESIGN[fn.id]) return;
      expect(fn.body, `${fn.id} has no identity check; add one or argue for it in PUBLIC_BY_DESIGN`).toMatch(IDENTITY);
    });
  }

  it("lists no open function that no longer exists", () => {
    const ids = new Set(fns.map((f) => f.id));
    for (const id of Object.keys(PUBLIC_BY_DESIGN)) expect(ids.has(id), id).toBe(true);
  });

  it("keeps the operator-only grants internal", () => {
    const src = readFileSync(resolve(CONVEX, "admin.ts"), "utf8");
    expect(src).toMatch(/export const grantAdmin = internalMutation\(/);
    const access = readFileSync(resolve(CONVEX, "access.ts"), "utf8");
    expect(access).toMatch(/export const approve = internalMutation\(/);
    expect(access).toMatch(/export const submit = internalMutation\(/);
  });
});
