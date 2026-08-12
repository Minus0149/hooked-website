import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// CORS handling is required because the SPA runs on a different origin.
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: ["https://app.hookedcue.com"],
  },
});

/**
 * Beta signup ingest for the landing site. Writes into the same
 * accessRequests queue the in-app wall uses, so the admin reviews one list.
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
    if (!secret || request.headers.get("x-beta-secret") !== secret) {
      return new Response("forbidden", { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const str = (value: unknown) => (typeof value === "string" ? value : "");
    const list = (value: unknown) =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

    try {
      const result = await ctx.runMutation(internal.access.record, {
        name: str(body.name),
        email: str(body.email),
        device: str(body.device),
        androidVersion: str(body.androidVersion),
        listensOn: list(body.listensOn),
        genres: list(body.genres),
        hours: str(body.hours),
        lastSkipped: str(body.lastSkipped),
        notes: str(body.notes),
        userAgent: str(body.userAgent),
      });
      // a duplicate is still a 200 — the landing has already told the person
      // they are on the list, and they are
      return Response.json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      console.error("[beta] ingest failed:", error);
      return new Response("invalid signup", { status: 422 });
    }
  }),
});

export default http;
