import { httpRouter } from "convex/server";
import { applyOriginAllowed } from "./applyOrigin";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { razorpayWebhook } from "./promotions";

const http = httpRouter();

// The web app's origin — the deployment's SITE_URL, so the dev deployment can
// serve a local build while production stays locked to app.hookedcue.com.
const APP_ORIGIN = process.env.SITE_URL ?? "https://app.hookedcue.com";
const MAX_BODY_BYTES = 8 * 1024;

// CORS handling is required because the SPA runs on a different origin.
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: [APP_ORIGIN],
  },
});

/** Cloudflare fronts this domain, so cf-connecting-ip is the trustworthy one. */
function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  return "unknown";
}

/**
 * Constant-time string compare.
 *
 * `a !== b` leaks how much of the secret matched through timing. The window is
 * tiny over the network, but there is no reason to hand it out.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

async function readJson(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { tooBig: true as const };
  try {
    return { body: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { bad: true as const };
  }
}

const corsHeaders = (origin: string | null) => ({
  "access-control-allow-origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  vary: "origin",
});

/**
 * The in-app wall's application form.
 *
 * An HTTP route rather than a public mutation so the caller's IP is visible —
 * a websocket mutation can only be limited per-email, and emails are free.
 * Locked to the app origin, and the response never says whether an email is
 * already known, so this can't be used to enumerate the queue.
 */
http.route({
  path: "/access/apply",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = request.headers.get("origin");
    if (origin !== APP_ORIGIN) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }),
});

http.route({
  path: "/access/apply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("origin");
    if (!applyOriginAllowed(origin, APP_ORIGIN)) return new Response("forbidden", { status: 403 });
    // CORS headers only mean something to a browser; the phone sends no Origin
    const headers = {
      ...(origin ? corsHeaders(origin) : {}),
      "content-type": "application/json",
    };

    const parsed = await readJson(request);
    if ("tooBig" in parsed) return new Response("too large", { status: 413, headers });
    if ("bad" in parsed) return new Response("bad request", { status: 400, headers });
    const body = parsed.body;

    // bot traps, matching the landing form: a filled honeypot or an impossibly
    // fast fill answers 200 so a script can't tell it was caught
    const honeypot = str(body.website).trim();
    const startedAt = typeof body.startedAt === "number" ? body.startedAt : 0;
    const elapsed = startedAt > 0 ? Date.now() - startedAt : Infinity;
    if (honeypot || elapsed < 2_500) {
      return Response.json({ ok: true, duplicate: false, status: "pending" }, { headers });
    }

    try {
      const result = await ctx.runMutation(internal.access.submit, {
        ip: clientIp(request),
        name: str(body.name),
        email: str(body.email),
        device: str(body.device) || undefined,
        genres: list(body.genres),
        notes: str(body.notes) || undefined,
        userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200),
      });
      return Response.json({ ok: true, ...result }, { headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not submit";
      const rateLimited = message.includes("Too many requests");
      return Response.json(
        { ok: false, message: rateLimited ? "too many tries. give it a bit." : message },
        { status: rateLimited ? 429 : 400, headers },
      );
    }
  }),
});

/**
 * Beta signup ingest for the landing site. Writes into the same accessRequests
 * queue the in-app wall uses, so the admin reviews one list.
 *
 * The landing server posts here from its own API route, never the browser, so
 * this is guarded by a shared secret rather than by origin — an unauthenticated
 * public endpoint that writes rows would be filled with junk within a day.
 * Set it with: npx convex env set BETA_INGEST_SECRET "<random-32-bytes>"
 */
http.route({
  path: "/beta",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.BETA_INGEST_SECRET;
    const provided = request.headers.get("x-beta-secret") ?? "";
    if (!secret || !safeEqual(provided, secret)) {
      return new Response("forbidden", { status: 403 });
    }

    const parsed = await readJson(request);
    if ("tooBig" in parsed) return new Response("too large", { status: 413 });
    if ("bad" in parsed) return new Response("bad request", { status: 400 });
    const body = parsed.body;

    try {
      const result = await ctx.runMutation(internal.access.record, {
        ip: clientIp(request),
        name: str(body.name),
        email: str(body.email),
        device: str(body.device),
        androidVersion: str(body.androidVersion),
        listensOn: list(body.listensOn),
        genres: list(body.genres),
        hours: str(body.hours),
        lastSkipped: str(body.lastSkipped),
        notes: str(body.notes),
        userAgent: str(body.userAgent) || (request.headers.get("user-agent") ?? "").slice(0, 200),
      });
      // a duplicate is still a 200 — the landing has already told the person
      // they are on the list, and they are
      return Response.json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      console.error("[access] landing ingest failed:", error);
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Too many requests")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response("invalid signup", { status: 422 });
    }
  }),
});

/**
 * External hook analyzer service.
 *
 * The analyzer runs where ffmpeg lives (a laptop, a CI job), not in Convex —
 * see scripts/analyze-hooks.mjs. GET hands out the tracks still waiting for
 * measurement; POST takes the measured windows back. Both are guarded by a
 * shared secret, set with:
 *   npx convex env set HOOK_ANALYZE_KEY "<random-32-bytes>"
 *
 * The body cap is generous because one POST can carry windows for many tracks.
 */
http.route({
  path: "/analyzer/pending",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.HOOK_ANALYZE_KEY;
    const provided = request.headers.get("x-analyzer-key") ?? "";
    if (!secret || !safeEqual(provided, secret)) {
      return new Response("forbidden", { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? 50);
    const safeLimit = Number.isFinite(limit) ? limit : 50;
    // ?energyCal=N asks for tracks whose energy predates calibration N
    const cal = Number(params.get("energyCal"));
    const tracks =
      params.has("energyCal") && Number.isInteger(cal) && cal > 0
        ? await ctx.runQuery(internal.analyzer.staleEnergyTracks, { limit: safeLimit, cal })
        : await ctx.runQuery(internal.analyzer.pendingTracks, { limit: safeLimit });
    return Response.json({ ok: true, tracks }, { status: 200 });
  }),
});

const ANALYZER_MAX_BODY_BYTES = 512 * 1024;

http.route({
  path: "/analyzer/ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.HOOK_ANALYZE_KEY;
    const provided = request.headers.get("x-analyzer-key") ?? "";
    if (!secret || !safeEqual(provided, secret)) {
      return new Response("forbidden", { status: 403 });
    }

    const raw = await request.text();
    if (raw.length > ANALYZER_MAX_BODY_BYTES) {
      return new Response("too large", { status: 413 });
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return new Response("bad request", { status: 400 });
    }

    type Result =
      | { trackId: string; ok: true; written: number; energy: number | null }
      | { trackId: string; ok: false; reason?: string };
    const results: Result[] = [];

    // accept both a single {trackId, windows} and a batch [{...}, ...]
    const items: unknown[] = Array.isArray(body.batch) ? body.batch : [body];
    for (const item of items.slice(0, 500)) {
      const rec = item as Record<string, unknown>;
      const trackId = str(rec.trackId);
      const analyzedAt = str(rec.analyzedAt) || new Date().toISOString();
      const cal = typeof rec.energyCal === "number" && Number.isInteger(rec.energyCal) ? rec.energyCal : undefined;
      if (trackId && rec.energyOnly === true && cal !== undefined) {
        try {
          const result = await ctx.runMutation(internal.analyzer.ingestEnergy, {
            trackId,
            energy: typeof rec.energy === "number" ? rec.energy : null,
            cal,
          });
          results.push(
            result.ok
              ? { trackId, ok: true, written: 0, energy: result.energy }
              : { trackId, ok: false, reason: result.reason },
          );
        } catch {
          results.push({ trackId, ok: false, reason: "write failed" });
        }
        continue;
      }
      if (!trackId || !Array.isArray(rec.windows)) continue;
      try {
        const result = await ctx.runMutation(internal.analyzer.ingestHooks, {
          trackId,
          analyzedAt,
          windows: rec.windows as { startMs: number; durationMs: number }[],
          energy: typeof rec.energy === "number" ? rec.energy : undefined,
          energyCal: cal,
        });
        results.push(
          result.ok
            ? { trackId, ok: true, written: result.written, energy: result.energy }
            : { trackId, ok: false, reason: result.reason },
        );
      } catch {
        results.push({ trackId, ok: false, reason: "write failed" });
      }
    }
    return Response.json({ ok: true, results }, { status: 200 });
  }),
});

/**
 * The sound analyser (scripts/analyze-sound.mjs): same key as the hook
 * analyser, its own pair of routes so the two can run independently.
 */
http.route({
  path: "/analyzer/sound-pending",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.HOOK_ANALYZE_KEY;
    const provided = request.headers.get("x-analyzer-key") ?? "";
    if (!secret || !safeEqual(provided, secret)) return new Response("forbidden", { status: 403 });
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? 100);
    const version = Number(params.get("version") ?? 0);
    if (!Number.isInteger(version) || version < 1) return new Response("bad version", { status: 400 });
    const tracks = await ctx.runQuery(internal.analyzer.soundPendingTracks, {
      limit: Number.isFinite(limit) ? limit : 100,
      version,
    });
    return Response.json({ ok: true, tracks }, { status: 200 });
  }),
});

http.route({
  path: "/analyzer/sound-ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.HOOK_ANALYZE_KEY;
    const provided = request.headers.get("x-analyzer-key") ?? "";
    if (!secret || !safeEqual(provided, secret)) return new Response("forbidden", { status: 403 });
    const raw = await request.text();
    if (raw.length > ANALYZER_MAX_BODY_BYTES) return new Response("too large", { status: 413 });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const items: unknown[] = Array.isArray(body.batch) ? body.batch : [];
    let heard = 0;
    let written = 0;
    for (const item of items.slice(0, 200)) {
      const rec = item as Record<string, unknown>;
      const trackId = str(rec.trackId);
      const version = typeof rec.version === "number" ? rec.version : NaN;
      if (!trackId || !Number.isInteger(version)) continue;
      try {
        const r = await ctx.runMutation(internal.analyzer.ingestSound, {
          trackId,
          version,
          sound: typeof rec.sound === "string" ? rec.sound : undefined,
          audioMood: Array.isArray(rec.audioMood)
            ? (rec.audioMood as unknown[]).filter((x): x is number => typeof x === "number")
            : undefined,
          vocal: typeof rec.vocal === "number" ? rec.vocal : undefined,
        });
        if (r.ok) {
          written++;
          if (r.heard) heard++;
        }
      } catch {
        /* one bad row doesn't sink the batch */
      }
    }
    return Response.json({ ok: true, written, heard }, { status: 200 });
  }),
});

// Razorpay payment and refund events for paid promotion (convex/promotions.ts);
// the handler checks the signature and deduplicates retries itself
http.route({ path: "/razorpay/webhook", method: "POST", handler: razorpayWebhook });

/**
 * One part of the catalogue file (convex/catalog.ts), by version. Public data —
 * the same songs every guest is dealt — so any origin may read it.
 *
 * ?v=<current version> is immutable: a new catalogue is a new version and new
 * URLs, so a browser may keep these responses forever. Any other ?v gets the
 * current part uncached, and the document says which version it is. The HTTP
 * layer gzips the response itself when the client accepts it.
 */
http.route({
  path: "/catalog",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const part = Math.max(0, Math.floor(Number(url.searchParams.get("part") ?? 0)) || 0);
    const cur = await ctx.runQuery(internal.catalog.current, { part });
    const base = { "access-control-allow-origin": "*" };
    if (!cur) {
      return new Response("catalogue is being built", {
        status: 503,
        headers: { ...base, "retry-after": "30", "cache-control": "no-store" },
      });
    }
    if (!cur.fileId) return new Response("no such part", { status: 404, headers: base });
    const file = await ctx.storage.get(cur.fileId);
    if (!file) return new Response("catalogue file missing", { status: 503, headers: base });
    const isCurrent = url.searchParams.get("v") === String(cur.version);
    return new Response(file, {
      status: 200,
      headers: {
        ...base,
        "content-type": "application/json; charset=utf-8",
        "x-catalog-version": String(cur.version),
        "x-catalog-parts": String(cur.parts),
        "cache-control": isCurrent ? "public, max-age=31536000, immutable" : "no-store",
      },
    });
  }),
});

export default http;
