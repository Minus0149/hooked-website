import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

const APP_ORIGIN = "https://app.hookedcue.com";
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
    if (origin !== APP_ORIGIN) return new Response("forbidden", { status: 403 });
    const headers = { ...corsHeaders(origin), "content-type": "application/json" };

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

export default http;
