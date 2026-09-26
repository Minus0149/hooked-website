import { v } from "convex/values";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  checkCode,
  coercePromotionConfig,
  countsAsListen,
  mayDeal,
  normaliseCode,
  packagesFor,
  paymentSignatureValid,
  quote,
  refundFor,
  remainingCapacity,
  saveRate,
  webhookSignatureValid,
  type CreatorRate,
  type DiscountCode,
  type PromotionConfig,
} from "./promotionRules";
import {
  cleanText,
  enforceRateLimit,
  ensureActiveProfile,
  getProfile,
  hasPermission,
  requirePermission,
  requireUser,
} from "./security";

/**
 * Paid promotion: an approved artist pays to have their own song dealt, at its
 * hook, to listeners who haven't heard it. Prices and policy are explained in
 * web/docs/PROMOTIONS.md; every number is decided in promotionRules.ts.
 *
 * Trust boundaries:
 *   - the client names a package (and maybe a code); the server prices it
 *   - an order is paid only with Razorpay's signature (checkout) or a signed
 *     webhook; either path lands in markPaid, which is idempotent
 *   - a listen is counted server-side, once per listener per campaign
 *
 * Without RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET on
 * the deployment everything still loads and says "payments not configured".
 */

const CONFIG_KEY = "promotion";
const DAY = 86_400_000;
const RAZORPAY_API = "https://api.razorpay.com/v1";

const paymentsConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

async function readConfig(ctx: QueryCtx): Promise<PromotionConfig> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", CONFIG_KEY))
    .unique();
  return coercePromotionConfig(row?.value);
}

async function rateFor(ctx: QueryCtx, userId: string): Promise<CreatorRate | null> {
  const row = await ctx.db
    .query("promotionRates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  return row ? { per1000Paise: row.per1000Paise, customPackages: row.customPackages } : null;
}

async function codeRow(ctx: QueryCtx, code: string | undefined) {
  if (!code) return null;
  return ctx.db
    .query("promotionCodes")
    .withIndex("by_code", (q) => q.eq("code", normaliseCode(code)))
    .unique();
}

const asDiscount = (row: Doc<"promotionCodes"> | null): DiscountCode | null =>
  row
    ? {
        code: row.code,
        percentOff: row.percentOff,
        amountOffPaise: row.amountOffPaise,
        expiresAt: row.expiresAt,
        maxUses: row.maxUses,
        uses: row.uses,
        active: row.active,
        creatorUserId: row.creatorUserId,
      }
    : null;

/** An approved creator (or a curator). Same rule as creators.ts, read-only here. */
async function requireSeller(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx);
  const profile = await getProfile(ctx, user.id);
  ensureActiveProfile(profile);
  if (hasPermission(profile, "catalog.curate")) return user;
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_userId", (q) => q.eq("userId", user.id))
    .unique();
  if (creator?.status !== "approved") throw new Error("Promotion is for approved artists.");
  return user;
}

async function owedListeners(ctx: QueryCtx): Promise<number> {
  const active = await ctx.db
    .query("promotionCampaigns")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .collect();
  return active.reduce((n, c) => n + Math.max(0, c.listeners - c.delivered), 0);
}

async function isFirstCampaign(ctx: QueryCtx, userId: string): Promise<boolean> {
  const paid = await ctx.db
    .query("promotionOrders")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("status"), "paid"))
    .first();
  return paid === null;
}

/** A song the artist may promote: theirs, live in the deck, with audio. */
async function promotableTrack(ctx: QueryCtx, trackId: string, userId: string, curator: boolean) {
  const track = await ctx.db
    .query("tracks")
    .withIndex("by_trackId", (q) => q.eq("trackId", cleanText(trackId, 120)))
    .unique();
  if (!track) throw new Error("No such song.");
  if (!curator && track.ownerUserId !== userId) throw new Error("You can only promote your own songs.");
  if (track.hidden) throw new Error("Publish the song before promoting it.");
  if (!track.previewUrl && !track.audioStorageId) throw new Error("The song has no audio yet.");
  return track;
}

// ------------------------------------------------------------------ offer

/** What this artist can buy, at their price. They never see anyone else's rate. */
export const offer = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireSeller(ctx);
    const config = await readConfig(ctx);
    const packages = packagesFor(config, await rateFor(ctx, user.id));
    const left = remainingCapacity(config, await owedListeners(ctx));
    const first = await isFirstCampaign(ctx, user.id);
    return {
      enabled: config.enabled,
      paymentsConfigured: paymentsConfigured(),
      windowDays: config.windowDays,
      launchOffer: first && config.launchOffer.enabled ? config.launchOffer.percentOff : 0,
      packages: packages.map((p) => ({
        ...p,
        available: p.listeners <= left,
        quote: quote({ pkg: p, launchOffer: config.launchOffer, firstCampaign: first, code: null }),
      })),
    };
  },
});

/** Price check for a code before paying — the same calculation beginOrder uses. */
export const previewPrice = query({
  args: { packageId: v.string(), code: v.optional(v.string()) },
  handler: async (ctx, { packageId, code }) => {
    const user = await requireSeller(ctx);
    const config = await readConfig(ctx);
    const pkg = packagesFor(config, await rateFor(ctx, user.id)).find((p) => p.id === packageId);
    if (!pkg) return { ok: false as const, reason: "That package isn't available." };
    const row = await codeRow(ctx, code);
    if (code) {
      const verdict = checkCode(asDiscount(row), Date.now(), user.id);
      if (!verdict.ok) return { ok: false as const, reason: verdict.reason };
    }
    return {
      ok: true as const,
      quote: quote({
        pkg,
        launchOffer: config.launchOffer,
        firstCampaign: await isFirstCampaign(ctx, user.id),
        code: code ? asDiscount(row) : null,
      }),
    };
  },
});

// ------------------------------------------------------------------ buying

/** Step 1: price the order on the server and write it down. */
export const beginOrder = mutation({
  args: { trackId: v.string(), packageId: v.string(), code: v.optional(v.string()) },
  handler: async (ctx, { trackId, packageId, code }) => {
    const user = await requireSeller(ctx);
    await enforceRateLimit(ctx, `promo:order:${user.id}`, 10, 60 * 60_000);
    const config = await readConfig(ctx);
    if (!config.enabled) throw new Error("Promotion is paused right now.");
    const profile = await getProfile(ctx, user.id);
    const track = await promotableTrack(ctx, trackId, user.id, hasPermission(profile, "catalog.curate"));
    const pkg = packagesFor(config, await rateFor(ctx, user.id)).find((p) => p.id === packageId);
    if (!pkg) throw new Error("That package isn't available.");
    if (pkg.listeners > remainingCapacity(config, await owedListeners(ctx))) {
      throw new Error("That package is full for now — try a smaller one.");
    }
    const row = await codeRow(ctx, code);
    if (code) {
      const verdict = checkCode(asDiscount(row), Date.now(), user.id);
      if (!verdict.ok) throw new Error(verdict.reason);
    }
    const q = quote({
      pkg,
      launchOffer: config.launchOffer,
      firstCampaign: await isFirstCampaign(ctx, user.id),
      code: code ? asDiscount(row) : null,
    });
    const orderId = await ctx.db.insert("promotionOrders", {
      userId: user.id,
      trackId: track.trackId,
      packageId: pkg.id,
      listeners: pkg.listeners,
      basePaise: q.basePaise,
      launchOffPaise: q.launchOffPaise,
      codeOffPaise: q.codeOffPaise,
      totalPaise: q.totalPaise,
      currency: "INR",
      code: row ? row.code : undefined,
      status: "created",
      createdAt: Date.now(),
    });
    return { orderId, quote: q };
  },
});

export const orderForCheckout = internalQuery({
  args: { orderId: v.id("promotionOrders") },
  handler: async (ctx, { orderId }) => ctx.db.get(orderId),
});

export const attachRazorpayOrder = internalMutation({
  args: { orderId: v.id("promotionOrders"), razorpayOrderId: v.string() },
  handler: async (ctx, { orderId, razorpayOrderId }) => {
    await ctx.db.patch(orderId, { razorpayOrderId });
  },
});

/** Step 2: create the Razorpay order for exactly the stored amount. */
export const checkout = action({
  args: { orderId: v.id("promotionOrders") },
  handler: async (
    ctx,
    { orderId },
  ): Promise<
    | { configured: false }
    | { configured: true; keyId: string; razorpayOrderId: string; amount: number; currency: "INR" }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const order = await ctx.runQuery(internal.promotions.orderForCheckout, { orderId });
    if (!order || order.userId !== identity.subject) throw new Error("No such order.");
    if (order.status !== "created") throw new Error("This order is already settled.");
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return { configured: false };
    if (order.razorpayOrderId) {
      return { configured: true, keyId, razorpayOrderId: order.razorpayOrderId, amount: order.totalPaise, currency: "INR" };
    }
    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
      },
      body: JSON.stringify({
        amount: order.totalPaise,
        currency: "INR",
        receipt: String(orderId).slice(0, 40),
        notes: { trackId: order.trackId, packageId: order.packageId },
      }),
    });
    if (!res.ok) throw new Error(`Razorpay refused the order (${res.status}).`);
    const created = (await res.json()) as { id: string; amount: number };
    if (created.amount !== order.totalPaise) throw new Error("Razorpay returned a different amount.");
    await ctx.runMutation(internal.promotions.attachRazorpayOrder, { orderId, razorpayOrderId: created.id });
    return { configured: true, keyId, razorpayOrderId: created.id, amount: order.totalPaise, currency: "INR" };
  },
});

/** Step 3 (checkout's success handler): trust it only with a valid signature. */
export const confirmPayment = action({
  args: {
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
    razorpaySignature: v.string(),
  },
  handler: async (ctx, args): Promise<{ campaignId: Id<"promotionCampaigns"> | null }> => {
    const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
    const ok = await paymentSignatureValid(args.razorpayOrderId, args.razorpayPaymentId, args.razorpaySignature, secret);
    if (!ok) throw new Error("That payment couldn't be verified.");
    return ctx.runMutation(internal.promotions.markPaid, {
      razorpayOrderId: args.razorpayOrderId,
      razorpayPaymentId: args.razorpayPaymentId,
    });
  },
});

/** The one way an order becomes a campaign. Safe to call twice (checkout + webhook). */
export const markPaid = internalMutation({
  args: { razorpayOrderId: v.string(), razorpayPaymentId: v.string() },
  handler: async (ctx, { razorpayOrderId, razorpayPaymentId }): Promise<{ campaignId: Id<"promotionCampaigns"> | null }> => {
    const order = await ctx.db
      .query("promotionOrders")
      .withIndex("by_rzp_order", (q) => q.eq("razorpayOrderId", razorpayOrderId))
      .unique();
    if (!order) return { campaignId: null };
    if (order.status === "paid") {
      const existing = await ctx.db
        .query("promotionCampaigns")
        .withIndex("by_user", (q) => q.eq("userId", order.userId))
        .filter((q) => q.eq(q.field("orderId"), order._id))
        .first();
      return { campaignId: existing?._id ?? null };
    }
    const now = Date.now();
    await ctx.db.patch(order._id, { status: "paid", razorpayPaymentId, paidAt: now });
    if (order.code) {
      const code = await codeRow(ctx, order.code);
      if (code) await ctx.db.patch(code._id, { uses: code.uses + 1 });
    }
    const config = await readConfig(ctx);
    const campaignId = await ctx.db.insert("promotionCampaigns", {
      userId: order.userId,
      trackId: order.trackId,
      orderId: order._id,
      listeners: order.listeners,
      delivered: 0,
      stats: { listens: 0, saves: 0, skips: 0, more: 0, never: 0 },
      status: "active",
      startedAt: now,
      endsAt: now + config.windowDays * DAY,
    });
    return { campaignId };
  },
});

export const markFailed = internalMutation({
  args: { razorpayOrderId: v.string() },
  handler: async (ctx, { razorpayOrderId }) => {
    const order = await ctx.db
      .query("promotionOrders")
      .withIndex("by_rzp_order", (q) => q.eq("razorpayOrderId", razorpayOrderId))
      .unique();
    if (order && order.status === "created") await ctx.db.patch(order._id, { status: "failed" });
  },
});

/** Returns false for an event already handled — Razorpay retries webhooks. */
export const claimEvent = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const seen = await ctx.db
      .query("razorpayEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (seen) return false;
    await ctx.db.insert("razorpayEvents", { eventId, at: Date.now() });
    return true;
  },
});

export const refundSettled = internalMutation({
  args: { refundId: v.string(), ok: v.boolean() },
  handler: async (ctx, { refundId, ok }) => {
    const c = await ctx.db
      .query("promotionCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "expired"))
      .filter((q) => q.eq(q.field("refundId"), refundId))
      .first();
    const target =
      c ??
      (await ctx.db
        .query("promotionCampaigns")
        .withIndex("by_status", (q) => q.eq("status", "cancelled"))
        .filter((q) => q.eq(q.field("refundId"), refundId))
        .first());
    if (target) await ctx.db.patch(target._id, { refundStatus: ok ? "done" : "failed" });
  },
});

/**
 * POST /razorpay/webhook (routed in http.ts). Signed with the webhook secret
 * over the raw body; deduplicated by x-razorpay-event-id.
 */
export const razorpayWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return new Response("payments not configured", { status: 503 });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return new Response("too large", { status: 413 });
  const ok = await webhookSignatureValid(raw, request.headers.get("x-razorpay-signature") ?? "", secret);
  if (!ok) return new Response("bad signature", { status: 401 });
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";
  if (eventId && !(await ctx.runMutation(internal.promotions.claimEvent, { eventId }))) {
    return new Response("ok", { status: 200 });
  }
  let body: {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string } };
      order?: { entity?: { id?: string } };
      refund?: { entity?: { id?: string } };
    };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const payment = body.payload?.payment?.entity;
  const orderId = body.payload?.order?.entity?.id ?? payment?.order_id;
  switch (body.event) {
    case "order.paid":
    case "payment.captured":
      if (orderId && payment?.id) {
        await ctx.runMutation(internal.promotions.markPaid, { razorpayOrderId: orderId, razorpayPaymentId: payment.id });
      }
      break;
    case "payment.failed":
      if (orderId) await ctx.runMutation(internal.promotions.markFailed, { razorpayOrderId: orderId });
      break;
    case "refund.processed":
    case "refund.failed": {
      const refundId = body.payload?.refund?.entity?.id;
      if (refundId) await ctx.runMutation(internal.promotions.refundSettled, { refundId, ok: body.event === "refund.processed" });
      break;
    }
  }
  return new Response("ok", { status: 200 });
});

// ------------------------------------------------------------------ ending

/** Refund the undelivered share through Razorpay. Scheduled, never inline. */
export const issueRefund = internalAction({
  args: { campaignId: v.id("promotionCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const info = await ctx.runQuery(internal.promotions.refundInfo, { campaignId });
    if (!info || info.refundPaise <= 0 || !info.paymentId) return;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      await ctx.runMutation(internal.promotions.recordRefund, { campaignId, refundId: "", ok: false });
      return;
    }
    const res = await fetch(`${RAZORPAY_API}/payments/${encodeURIComponent(info.paymentId)}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Basic " + btoa(`${keyId}:${keySecret}`) },
      body: JSON.stringify({ amount: info.refundPaise, notes: { campaignId: String(campaignId) } }),
    });
    const out = res.ok ? ((await res.json()) as { id?: string }) : {};
    await ctx.runMutation(internal.promotions.recordRefund, { campaignId, refundId: out.id ?? "", ok: res.ok });
  },
});

export const refundInfo = internalQuery({
  args: { campaignId: v.id("promotionCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const c = await ctx.db.get(campaignId);
    if (!c) return null;
    const order = await ctx.db.get(c.orderId);
    return { refundPaise: c.refundPaise ?? 0, paymentId: order?.razorpayPaymentId ?? null };
  },
});

export const recordRefund = internalMutation({
  args: { campaignId: v.id("promotionCampaigns"), refundId: v.string(), ok: v.boolean() },
  handler: async (ctx, { campaignId, refundId, ok }) => {
    await ctx.db.patch(campaignId, { refundId: refundId || undefined, refundStatus: ok ? "pending" : "failed" });
  },
});

async function endCampaign(
  ctx: MutationCtx,
  c: Doc<"promotionCampaigns">,
  status: "expired" | "cancelled",
) {
  const order = await ctx.db.get(c.orderId);
  const refundPaise = refundFor(order?.totalPaise ?? 0, c.listeners, c.delivered);
  await ctx.db.patch(c._id, { status, endedAt: Date.now(), refundPaise });
  if (refundPaise > 0) {
    await ctx.scheduler.runAfter(0, internal.promotions.issueRefund, { campaignId: c._id });
  }
  return refundPaise;
}

/** The artist stops a campaign; what hasn't been delivered is refunded. */
export const cancelCampaign = mutation({
  args: { campaignId: v.id("promotionCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const c = await ctx.db.get(campaignId);
    if (!c || c.userId !== user.id) throw new Error("No such campaign.");
    if (c.status !== "active") throw new Error("This campaign has already ended.");
    return { refundPaise: await endCampaign(ctx, c, "cancelled") };
  },
});

/** Daily (crons.ts, phase B): end campaigns whose window is over. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("promotionCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(500);
    let ended = 0;
    for (const c of active) {
      if (c.endsAt <= now) {
        await endCampaign(ctx, c, "expired");
        ended++;
      }
    }
    return { ended };
  },
});

// ------------------------------------------------------------------ dealing

/**
 * The promoted song in the same shape as the catalogue file, so a client with
 * an older catalogue (or none) can still play it. Explicit fields only, like
 * tracks.list: owner ids and storage ids never leave the server.
 */
async function publicTrack(ctx: QueryCtx, trackId: string) {
  const t = await ctx.db
    .query("tracks")
    .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
    .unique();
  if (!t || t.hidden) return null;
  const hooks = (await ctx.db
    .query("hooks")
    .withIndex("by_trackId", (q) => q.eq("trackId", trackId))
    .collect())
    .filter((h) => h.active)
    .sort((a, b) => (a.rank ?? a.order) - (b.rank ?? b.order) || a.order - b.order);
  return {
    trackId: t.trackId,
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: t.artwork,
    previewUrl: t.previewUrl,
    durationMs: t.durationMs,
    genre: t.genre,
    accent: t.accent,
    energy: t.energy,
    sound: t.sound,
    audioMood: t.audioMood,
    vocal: t.vocal,
    audioUrl: t.audioStorageId ? await ctx.storage.getUrl(t.audioStorageId) : null,
    hooks: hooks.map((h) => ({ id: String(h._id), startMs: h.startMs, durationMs: h.durationMs, label: h.label })),
  };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function viewerKey(ctx: QueryCtx, anonKey: string | undefined): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) return `u:${identity.subject}`;
  const k = cleanText(anonKey ?? "", 64);
  return k.length >= 8 ? `a:${k}` : null;
}

/**
 * The next promoted song for this listener, or null. The client asks every
 * config.everyNCards cards; this enforces the daily cap and "never the same
 * campaign twice", and picks the campaign most behind its schedule.
 */
export const nextPromoted = query({
  args: { anonKey: v.optional(v.string()) },
  handler: async (ctx, { anonKey }) => {
    const config = await readConfig(ctx);
    if (!config.enabled) return null;
    const viewer = await viewerKey(ctx, anonKey);
    if (!viewer) return null;
    const now = Date.now();
    const today = await ctx.db
      .query("promotionViews")
      .withIndex("by_viewer_day", (q) => q.eq("viewer", viewer).eq("day", dayOf(now)))
      .collect();
    if (!mayDeal({ enabled: config.enabled, dealtToday: today.length, perListenerDaily: config.perListenerDaily })) {
      return null;
    }
    const active = await ctx.db
      .query("promotionCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(200);
    const ranked = active
      .filter((c) => c.endsAt > now && c.delivered < c.listeners && `u:${c.userId}` !== viewer)
      // furthest behind a straight line from start to end goes first
      .map((c) => ({ c, behind: (now - c.startedAt) / (c.endsAt - c.startedAt) - c.delivered / c.listeners }))
      .sort((a, b) => b.behind - a.behind);
    for (const { c } of ranked) {
      const seen = await ctx.db
        .query("promotionViews")
        .withIndex("by_campaign_viewer", (q) => q.eq("campaignId", c._id).eq("viewer", viewer))
        .first();
      if (seen) continue;
      const track = await publicTrack(ctx, c.trackId);
      if (!track) continue; // hidden or removed since it was bought
      return { campaignId: c._id, trackId: c.trackId, everyNCards: config.everyNCards, track };
    }
    return null;
  },
});

/** What happened to a promoted card: shown, listened (with ms), or a swipe. */
export const recordPromoted = mutation({
  args: {
    campaignId: v.id("promotionCampaigns"),
    anonKey: v.optional(v.string()),
    event: v.union(
      v.literal("shown"),
      v.literal("listen"),
      v.literal("save"),
      v.literal("skip"),
      v.literal("more"),
      v.literal("never"),
    ),
    playedMs: v.optional(v.number()),
  },
  handler: async (ctx, { campaignId, anonKey, event, playedMs }) => {
    const viewer = await viewerKey(ctx, anonKey);
    if (!viewer) return;
    await enforceRateLimit(ctx, `promo:view:${viewer}`, 120, 60_000);
    const c = await ctx.db.get(campaignId);
    if (!c || c.status !== "active") return;
    let view = await ctx.db
      .query("promotionViews")
      .withIndex("by_campaign_viewer", (q) => q.eq("campaignId", campaignId).eq("viewer", viewer))
      .first();
    if (!view) {
      const id = await ctx.db.insert("promotionViews", {
        campaignId,
        viewer,
        day: dayOf(Date.now()),
        listened: false,
        at: Date.now(),
      });
      view = (await ctx.db.get(id))!;
    }
    if (event === "shown") return;
    if (event === "listen") {
      if (!countsAsListen(playedMs ?? 0, view.listened)) return;
      await ctx.db.patch(view._id, { listened: true });
      const delivered = c.delivered + 1;
      const done = delivered >= c.listeners;
      await ctx.db.patch(c._id, {
        delivered,
        stats: { ...c.stats, listens: c.stats.listens + 1 },
        ...(done ? { status: "completed" as const, endedAt: Date.now() } : {}),
      });
      return;
    }
    if (view.outcome) return; // one outcome per listener per campaign
    await ctx.db.patch(view._id, { outcome: event });
    const key = event === "save" ? "saves" : event === "skip" ? "skips" : event === "more" ? "more" : "never";
    await ctx.db.patch(c._id, { stats: { ...c.stats, [key]: c.stats[key] + 1 } });
  },
});

// ------------------------------------------------------------------ artist view

/** An artist's own campaigns and orders — never anyone else's. */
export const myCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const campaigns = await ctx.db
      .query("promotionCampaigns")
      .withIndex("by_user", (q) => q.eq("userId", user.id))
      .collect();
    const out = [];
    for (const c of campaigns.sort((a, b) => b.startedAt - a.startedAt)) {
      const track = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", c.trackId))
        .unique();
      const order = await ctx.db.get(c.orderId);
      out.push({
        id: c._id,
        trackId: c.trackId,
        title: track?.title ?? "(removed song)",
        status: c.status,
        listeners: c.listeners,
        delivered: c.delivered,
        stats: c.stats,
        saveRate: saveRate(c.stats),
        startedAt: c.startedAt,
        endsAt: c.endsAt,
        paidPaise: order?.totalPaise ?? 0,
        refundPaise: c.refundPaise ?? 0,
        refundStatus: c.refundStatus ?? null,
      });
    }
    return out;
  },
});

// ------------------------------------------------------------------ admin

export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "ads.manage");
    const config = await readConfig(ctx);
    const campaigns = await ctx.db.query("promotionCampaigns").order("desc").take(100);
    const orders = await ctx.db.query("promotionOrders").order("desc").take(200);
    const rates = await ctx.db.query("promotionRates").take(200);
    const codes = await ctx.db.query("promotionCodes").order("desc").take(200);
    const paid = orders.filter((o) => o.status === "paid");
    const artists = (
      await ctx.db
        .query("creators")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .take(500)
    ).map((c) => ({ userId: c.userId, artistName: c.artistName, email: c.email }));
    const titles = new Map<string, string>();
    for (const c of campaigns) {
      if (titles.has(c.trackId)) continue;
      const t = await ctx.db
        .query("tracks")
        .withIndex("by_trackId", (q) => q.eq("trackId", c.trackId))
        .unique();
      titles.set(c.trackId, t?.title ?? c.trackId);
    }
    return {
      artists,
      titles: Object.fromEntries(titles),
      config,
      paymentsConfigured: paymentsConfigured(),
      webhookConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      owedListeners: await owedListeners(ctx),
      revenuePaise: paid.reduce((n, o) => n + o.totalPaise, 0),
      refundedPaise: campaigns.reduce((n, c) => n + (c.refundStatus === "done" ? c.refundPaise ?? 0 : 0), 0),
      campaigns,
      orders,
      rates,
      codes,
    };
  },
});

export const setConfig = mutation({
  args: { value: v.any() },
  handler: async (ctx, { value }) => {
    await requirePermission(ctx, "ads.manage");
    const clean = coercePromotionConfig(value);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", CONFIG_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: clean });
    else await ctx.db.insert("appSettings", { key: CONFIG_KEY, value: clean });
    return clean;
  },
});

/** A personal price for one artist. Both fields empty removes it. */
export const setRate = mutation({
  args: {
    userId: v.string(),
    per1000Paise: v.optional(v.number()),
    customPackages: v.optional(
      v.array(v.object({ id: v.string(), name: v.string(), listeners: v.number(), pricePaise: v.number() })),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ads.manage");
    const admin = await requireUser(ctx);
    const existing = await ctx.db
      .query("promotionRates")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    // the same clamps the list prices get, by running them through the config reader
    const packages = args.customPackages?.length
      ? coercePromotionConfig({ packages: args.customPackages }).packages
      : undefined;
    const per1000 =
      args.per1000Paise === undefined ? undefined : Math.min(Math.max(Math.round(args.per1000Paise), 1_000), 1_000_000);
    if (per1000 === undefined && !packages) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const value = {
      userId: args.userId,
      per1000Paise: per1000,
      customPackages: packages,
      note: args.note ? cleanText(args.note, 200) : undefined,
      updatedAt: Date.now(),
      updatedBy: admin.id,
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("promotionRates", value);
    return value;
  },
});

export const createCode = mutation({
  args: {
    code: v.string(),
    percentOff: v.optional(v.number()),
    amountOffPaise: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    maxUses: v.optional(v.number()),
    creatorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ads.manage");
    const admin = await requireUser(ctx);
    const code = normaliseCode(args.code);
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) throw new Error("Codes are 3–24 letters, numbers or dashes.");
    if (!args.percentOff === !args.amountOffPaise) throw new Error("Give either a percentage or an amount off.");
    const clash = await codeRow(ctx, code);
    if (clash) throw new Error("That code already exists.");
    await ctx.db.insert("promotionCodes", {
      code,
      percentOff: args.percentOff ? Math.min(Math.max(Math.round(args.percentOff), 1), 90) : undefined,
      amountOffPaise: args.amountOffPaise ? Math.max(Math.round(args.amountOffPaise), 100) : undefined,
      expiresAt: args.expiresAt,
      maxUses: args.maxUses ? Math.max(1, Math.round(args.maxUses)) : undefined,
      uses: 0,
      active: true,
      creatorUserId: args.creatorUserId,
      createdAt: Date.now(),
      createdBy: admin.id,
    });
    return { code };
  },
});

export const setCodeActive = mutation({
  args: { code: v.string(), active: v.boolean() },
  handler: async (ctx, { code, active }) => {
    await requirePermission(ctx, "ads.manage");
    const row = await codeRow(ctx, code);
    if (!row) throw new Error("No such code.");
    await ctx.db.patch(row._id, { active });
  },
});
