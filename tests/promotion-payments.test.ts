import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORDER_HOLD_MS, discountsAtOrder, paymentSettles } from "../convex/promotionRules";

/**
 * Third security pass, paid promotion: discounts checked again at the till,
 * one Razorpay order per order, a campaign only for captured money, and guest
 * views bounded and swept.
 */
const src = (f: string) => readFileSync(resolve(__dirname, "..", "convex", f), "utf8");
const promotions = src("promotions.ts");
const fnBody = (name: string) => {
  const start = promotions.indexOf(`export const ${name} = `);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = promotions.indexOf("\nexport ", start + 1);
  return promotions.slice(start, next < 0 ? undefined : next);
};

const code = { code: "LAUNCH1", percentOff: 50, maxUses: 1, uses: 0, active: true };
const base = {
  launchOffPaise: 0,
  code: null,
  hasCode: false,
  firstCampaign: true,
  otherLaunchOrders: 0,
  otherCodeOrders: 0,
  now: 1_000,
  userId: "artist",
};

describe("discounts are checked again when the order is made", () => {
  it("a one-use code already paid for, or held by another open order, is refused", () => {
    expect(discountsAtOrder({ ...base, hasCode: true, code }).ok).toBe(true);
    expect(discountsAtOrder({ ...base, hasCode: true, code: { ...code, uses: 1 } }).ok).toBe(false);
    expect(discountsAtOrder({ ...base, hasCode: true, code, otherCodeOrders: 1 }).ok).toBe(false);
    expect(discountsAtOrder({ ...base, hasCode: true, code: null }).ok).toBe(false); // deleted since
    expect(discountsAtOrder({ ...base, hasCode: true, code: { ...code, maxUses: undefined }, otherCodeOrders: 9 }).ok).toBe(true);
  });

  it("the launch offer goes to one campaign: not after a paid one, not on two open orders", () => {
    expect(discountsAtOrder({ ...base, launchOffPaise: 500 }).ok).toBe(true);
    expect(discountsAtOrder({ ...base, launchOffPaise: 500, firstCampaign: false }).ok).toBe(false);
    expect(discountsAtOrder({ ...base, launchOffPaise: 500, otherLaunchOrders: 1 }).ok).toBe(false);
    // an order without the offer isn't held to it
    expect(discountsAtOrder({ ...base, firstCampaign: false }).ok).toBe(true);
  });

  it("beginOrder runs the check before any order exists, and only fresh unpaid orders hold a discount", () => {
    const begin = fnBody("beginOrder");
    expect(begin.indexOf("discountsAtOrder(")).toBeGreaterThan(0);
    expect(begin.indexOf("discountsAtOrder(")).toBeLessThan(begin.indexOf('insert("promotionOrders"'));
    expect(begin.indexOf("discountsAtOrder(")).toBeLessThan(begin.indexOf("if (r.orderId)"));
    expect(begin).toMatch(/o\.status === "created" && o\.requestId !== requestId && now - o\.createdAt < ORDER_HOLD_MS/);
    expect(begin).toMatch(/withIndex\("by_code_status"/);
    expect(ORDER_HOLD_MS).toBe(2 * 60 * 60_000);
  });
});

describe("one Razorpay order per order", () => {
  it("the first id attached stays, and checkout hands out whichever is stored", () => {
    const attach = fnBody("attachRazorpayOrder");
    expect(attach).toMatch(/if \(order\.razorpayOrderId\) return order\.razorpayOrderId;/);
    const checkout = fnBody("checkout");
    expect(checkout).toMatch(/const kept: string = await ctx\.runMutation\(internal\.promotions\.attachRazorpayOrder/);
    expect(checkout).toMatch(/razorpayOrderId: kept/);
  });
});

describe("a campaign starts only for money that was captured", () => {
  const order = { razorpayOrderId: "order_1", totalPaise: 9900 };
  it("captured, this order, this amount, in rupees", () => {
    expect(paymentSettles({ status: "captured", order_id: "order_1", amount: 9900, currency: "INR" }, order)).toBe(true);
    expect(paymentSettles({ status: "authorized", order_id: "order_1", amount: 9900, currency: "INR" }, order)).toBe(false);
    expect(paymentSettles({ status: "captured", order_id: "order_2", amount: 9900, currency: "INR" }, order)).toBe(false);
    expect(paymentSettles({ status: "captured", order_id: "order_1", amount: 100, currency: "INR" }, order)).toBe(false);
    expect(paymentSettles({ status: "captured", order_id: "order_1", amount: 9900, currency: "USD" }, order)).toBe(false);
    expect(paymentSettles(null, order)).toBe(false);
  });
  it("confirmPayment asks Razorpay before markPaid, and otherwise leaves it to the webhook", () => {
    const confirm = fnBody("confirmPayment");
    expect(confirm.indexOf("paymentSignatureValid")).toBeLessThan(confirm.indexOf("/payments/"));
    expect(confirm.indexOf("paymentSettles(")).toBeLessThan(confirm.indexOf("internal.promotions.markPaid"));
    expect(confirm).toMatch(/return \{ campaignId: null \};/);
  });
});

describe("guests' promoted-card views can't grow without end", () => {
  it("new guest rows have a shared hourly ceiling", () => {
    const record = fnBody("recordPromoted");
    expect(record).toMatch(/viewer\.startsWith\("a:"\)[\s\S]*?"promo:view:anon:new", ANON_VIEWS_PER_HOUR/);
  });
  it("rate-limit rows and old guest views are swept daily", () => {
    const retention = src("retention.ts");
    expect(retention).toMatch(/withIndex\("by_windowStart", \(q\) => q\.lt\("windowStart", Date\.now\(\) - RATE_LIMIT_KEEP_MS\)\)/);
    expect(retention).toMatch(/q\.gte\("viewer", "a:"\)\.lt\("viewer", "a;"\)/);
    const crons = src("crons.ts");
    expect(crons).toMatch(/internal\.retention\.sweepRateLimits/);
    expect(crons).toMatch(/internal\.retention\.sweepAnonPromotionViews/);
  });
});
