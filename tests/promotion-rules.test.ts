import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkCode,
  coercePromotionConfig,
  countsAsListen,
  DEFAULT_PROMOTION_CONFIG,
  MIN_ORDER_PAISE,
  mayDeal,
  normaliseCode,
  packagesFor,
  paymentSignatureValid,
  quote,
  refundFor,
  remainingCapacity,
  saveRate,
  webhookSignatureValid,
  type DiscountCode,
} from "../convex/promotionRules";

/**
 * Artists pay real money for promotion. The price is decided on the server
 * from these rules alone (the client only names a package), payments are
 * trusted only with a valid Razorpay signature, and undelivered listens are
 * refunded — each of those is pinned down here.
 */

const cfg = DEFAULT_PROMOTION_CONFIG;
const starter = cfg.packages.find((p) => p.id === "starter")!;
const code = (over: Partial<DiscountCode> = {}): DiscountCode => ({
  code: "LAUNCH",
  uses: 0,
  active: true,
  ...over,
});

describe("prices", () => {
  it("charges the list price with no offer or code", () => {
    const q = quote({ pkg: starter, launchOffer: { enabled: false, percentOff: 50 }, firstCampaign: true, code: null });
    expect(q.totalPaise).toBe(starter.pricePaise);
  });

  it("applies the launch offer only to a first campaign", () => {
    const first = quote({ pkg: starter, launchOffer: cfg.launchOffer, firstCampaign: true, code: null });
    const second = quote({ pkg: starter, launchOffer: cfg.launchOffer, firstCampaign: false, code: null });
    // ₹399 at 50% off is ₹200, not ₹199.50: discounts round down to whole rupees
    expect(first.totalPaise).toBe(20_000);
    expect(first.totalPaise % 100).toBe(0);
    expect(second.totalPaise).toBe(starter.pricePaise);
  });

  it("stacks a code after the launch offer and never goes under the floor", () => {
    const q = quote({ pkg: starter, launchOffer: cfg.launchOffer, firstCampaign: true, code: code({ percentOff: 90 }) });
    expect(q.totalPaise).toBe(MIN_ORDER_PAISE);
    expect(q.basePaise - q.launchOffPaise - q.codeOffPaise).toBe(q.totalPaise);
  });

  it("takes a fixed amount off, but not more than the order", () => {
    const q = quote({ pkg: starter, launchOffer: cfg.launchOffer, firstCampaign: false, code: code({ amountOffPaise: 10_000 }) });
    expect(q.totalPaise).toBe(starter.pricePaise - 10_000);
  });

  it("re-prices every package for an artist with a personal rate, and adds their own", () => {
    const pk = packagesFor(cfg, {
      per1000Paise: 50_000,
      customPackages: [{ id: "deal", name: "Your deal", listeners: 3_000, pricePaise: 99_900 }],
    });
    expect(pk.find((p) => p.id === "starter")!.pricePaise).toBe(25_000);
    expect(pk.find((p) => p.id === "deal")).toBeTruthy();
    // everyone else still sees the list
    expect(packagesFor(cfg, null).find((p) => p.id === "starter")!.pricePaise).toBe(starter.pricePaise);
  });

  it("keeps a stored config sane whatever was saved", () => {
    const c = coercePromotionConfig({ packages: [{ id: "x", listeners: -5, pricePaise: 1 }], launchOffer: { percentOff: 400 } });
    expect(c.packages[0].pricePaise).toBe(MIN_ORDER_PAISE);
    expect(c.packages[0].listeners).toBeGreaterThanOrEqual(10);
    expect(c.launchOffer.percentOff).toBeLessThanOrEqual(90);
    expect(coercePromotionConfig(null)).toEqual(DEFAULT_PROMOTION_CONFIG);
  });
});

describe("discount codes", () => {
  it("normalises what people type", () => {
    expect(normaliseCode(" launch 50 ")).toBe("LAUNCH50");
  });

  it("refuses expired, used-up, inactive and someone else's codes", () => {
    const now = 1_000;
    expect(checkCode(code({ expiresAt: 999 }), now, "u1").ok).toBe(false);
    expect(checkCode(code({ maxUses: 3, uses: 3 }), now, "u1").ok).toBe(false);
    expect(checkCode(code({ active: false }), now, "u1").ok).toBe(false);
    expect(checkCode(code({ creatorUserId: "u2" }), now, "u1").ok).toBe(false);
    expect(checkCode(null, now, "u1").ok).toBe(false);
    expect(checkCode(code({ expiresAt: 2_000, maxUses: 3, uses: 2, creatorUserId: "u1" }), now, "u1").ok).toBe(true);
  });
});

describe("Razorpay signatures", () => {
  const secret = "test_secret";
  const sign = (msg: string) => createHmac("sha256", secret).update(msg).digest("hex");

  it("accepts a genuine checkout signature and refuses a forged one", async () => {
    expect(await paymentSignatureValid("order_1", "pay_1", sign("order_1|pay_1"), secret)).toBe(true);
    expect(await paymentSignatureValid("order_1", "pay_2", sign("order_1|pay_1"), secret)).toBe(false);
    expect(await paymentSignatureValid("order_1", "pay_1", sign("order_1|pay_1"), "other")).toBe(false);
    expect(await paymentSignatureValid("order_1", "pay_1", "", secret)).toBe(false);
  });

  it("checks webhooks against the raw body", async () => {
    const body = '{"event":"order.paid","payload":{}}';
    expect(await webhookSignatureValid(body, sign(body), secret)).toBe(true);
    expect(await webhookSignatureValid(body + " ", sign(body), secret)).toBe(false);
  });
});

describe("delivery and refunds", () => {
  it("counts a listen once, from 3 seconds", () => {
    expect(countsAsListen(2_999, false)).toBe(false);
    expect(countsAsListen(3_000, false)).toBe(true);
    expect(countsAsListen(9_000, true)).toBe(false);
  });

  it("caps promoted cards per listener per day", () => {
    expect(mayDeal({ enabled: true, dealtToday: 1, perListenerDaily: 2 })).toBe(true);
    expect(mayDeal({ enabled: true, dealtToday: 2, perListenerDaily: 2 })).toBe(false);
    expect(mayDeal({ enabled: false, dealtToday: 0, perListenerDaily: 2 })).toBe(false);
  });

  it("refunds undelivered listens pro rata, rounding down", () => {
    expect(refundFor(39_900, 500, 500)).toBe(0);
    expect(refundFor(39_900, 500, 250)).toBe(19_950);
    expect(refundFor(39_900, 500, 0)).toBe(39_900);
    expect(refundFor(39_900, 3, 1)).toBe(26_600);
    expect(refundFor(39_900, 500, 900)).toBe(0);
  });

  it("won't sell more listeners than the platform can deliver", () => {
    expect(remainingCapacity(cfg, 800)).toBe(cfg.capacityListeners - 800);
    expect(remainingCapacity(cfg, 5_000)).toBe(0);
  });

  it("reports the save rate as a percentage", () => {
    expect(saveRate({ listens: 200, saves: 17, skips: 150, more: 20, never: 3 })).toBe(8.5);
    expect(saveRate({ listens: 0, saves: 0, skips: 0, more: 0, never: 0 })).toBe(0);
  });
});
