/**
 * Paid promotion for artists — the rules, with nothing Convex-specific in them
 * so every number can be tested. convex/promotions.ts does the storage and the
 * Razorpay calls; web/docs/PROMOTIONS.md explains the prices and the policy.
 *
 * Money is always integer paise. The client never sends a price: it sends a
 * package id (and maybe a code) and the server works the amount out here.
 */

// ------------------------------------------------------------------ config

export type PromotionPackage = {
  id: string;
  name: string;
  /** unique listeners who will hear the hook for at least 3 s */
  listeners: number;
  pricePaise: number;
};

export type PromotionConfig = {
  /** master switch: off, and nothing can be bought or dealt */
  enabled: boolean;
  packages: PromotionPackage[];
  /** first campaign discount, switched on and off by an admin */
  launchOffer: { enabled: boolean; percentOff: number };
  /** at most one promoted card in this many cards (the client paces) */
  everyNCards: number;
  /** promoted cards one listener may be dealt per day (the server enforces) */
  perListenerDaily: number;
  /** days a campaign has to deliver before the rest is refunded */
  windowDays: number;
  /**
   * listeners the platform can honestly deliver in one window, across all
   * campaigns. A beta can't reach 5,000 distinct people; selling it anyway
   * would only mean refunds. Packages above what's left are shown as full.
   */
  capacityListeners: number;
};

/**
 * Defaults, from the benchmarks in docs/PROMOTIONS.md: about ₹0.60–1.00 per
 * real listen — under YouTube's ₹1–3 per view and far under Spotify's ₹25+
 * per click, and a thousand times what bot-stream sellers charge, so it can't
 * be mistaken for one.
 */
export const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  enabled: true,
  packages: [
    { id: "try", name: "Try it", listeners: 100, pricePaise: 9_900 },
    { id: "starter", name: "Starter", listeners: 500, pricePaise: 39_900 },
    { id: "boost", name: "Boost", listeners: 2_000, pricePaise: 139_900 },
    { id: "launch", name: "Launch", listeners: 5_000, pricePaise: 299_900 },
  ],
  launchOffer: { enabled: true, percentOff: 50 },
  everyNCards: 10,
  perListenerDaily: 2,
  windowDays: 30,
  capacityListeners: 1_000,
};

/** Razorpay's floor is ₹1; ours is higher so fees never eat a whole order. */
export const MIN_ORDER_PAISE = 4_900;
export const MAX_ORDER_PAISE = 50_000_00; // ₹50,000 — anything above is a typo

const clampInt = (n: unknown, lo: number, hi: number, fallback: number) => {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(Math.max(x, lo), hi);
};

/** Whatever is stored, the reader gets a sane config back. */
export function coercePromotionConfig(raw: unknown): PromotionConfig {
  const d = DEFAULT_PROMOTION_CONFIG;
  const r = (raw ?? {}) as Partial<PromotionConfig>;
  const packages = Array.isArray(r.packages)
    ? r.packages
        .filter((p) => p && typeof p.id === "string" && /^[a-z0-9-]{1,24}$/.test(p.id))
        .map((p) => ({
          id: p.id,
          name: String(p.name ?? p.id).slice(0, 40),
          listeners: clampInt(p.listeners, 10, 1_000_000, 100),
          pricePaise: clampInt(p.pricePaise, MIN_ORDER_PAISE, MAX_ORDER_PAISE, MIN_ORDER_PAISE),
        }))
        .slice(0, 8)
    : d.packages;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    packages: packages.length > 0 ? packages : d.packages,
    launchOffer: {
      enabled: typeof r.launchOffer?.enabled === "boolean" ? r.launchOffer.enabled : d.launchOffer.enabled,
      percentOff: clampInt(r.launchOffer?.percentOff, 0, 90, d.launchOffer.percentOff),
    },
    everyNCards: clampInt(r.everyNCards, 4, 100, d.everyNCards),
    perListenerDaily: clampInt(r.perListenerDaily, 0, 10, d.perListenerDaily),
    windowDays: clampInt(r.windowDays, 7, 90, d.windowDays),
    capacityListeners: clampInt(r.capacityListeners, 0, 10_000_000, d.capacityListeners),
  };
}

// ------------------------------------------------------------------ prices

/** An admin-set rate for one artist. Either or both may be present. */
export type CreatorRate = {
  /** replaces the list price: paise per 1,000 listeners */
  per1000Paise?: number;
  /** extra packages only this artist sees */
  customPackages?: PromotionPackage[];
};

export type DiscountCode = {
  code: string;
  percentOff?: number;
  amountOffPaise?: number;
  expiresAt?: number;
  maxUses?: number;
  uses: number;
  active: boolean;
  /** only for this artist, if set */
  creatorUserId?: string;
};

/** Codes are typed by hand: case and spaces don't matter. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export type CodeVerdict = { ok: true } | { ok: false; reason: string };

export function checkCode(c: DiscountCode | null, now: number, creatorUserId: string): CodeVerdict {
  if (!c || !c.active) return { ok: false, reason: "That code isn't valid." };
  if (c.expiresAt !== undefined && now > c.expiresAt) return { ok: false, reason: "That code has expired." };
  if (c.maxUses !== undefined && c.uses >= c.maxUses) return { ok: false, reason: "That code has been used up." };
  if (c.creatorUserId && c.creatorUserId !== creatorUserId) return { ok: false, reason: "That code isn't valid." };
  return { ok: true };
}

/** The packages one artist can buy: the list, re-priced by their rate, plus their own. */
export function packagesFor(config: PromotionConfig, rate: CreatorRate | null): PromotionPackage[] {
  const priced = config.packages.map((p) =>
    rate?.per1000Paise
      ? { ...p, pricePaise: Math.max(MIN_ORDER_PAISE, Math.round((p.listeners * rate.per1000Paise) / 1000)) }
      : p,
  );
  return [...priced, ...(rate?.customPackages ?? [])];
}

export type Quote = {
  packageId: string;
  listeners: number;
  basePaise: number;
  launchOffPaise: number;
  codeOffPaise: number;
  totalPaise: number;
};

/**
 * The one place a price is decided. Launch offer first, then the code, then
 * the floor — so no combination of offers can take an order below ₹49.
 */
export function quote(opts: {
  pkg: PromotionPackage;
  launchOffer: PromotionConfig["launchOffer"];
  firstCampaign: boolean;
  code: DiscountCode | null;
}): Quote {
  const base = opts.pkg.pricePaise;
  let launchOff =
    opts.launchOffer.enabled && opts.firstCampaign ? Math.floor((base * opts.launchOffer.percentOff) / 100) : 0;
  const afterLaunch = base - launchOff;
  let codeOff = 0;
  if (opts.code) {
    if (opts.code.percentOff) codeOff = Math.floor((afterLaunch * Math.min(opts.code.percentOff, 90)) / 100);
    else if (opts.code.amountOffPaise) codeOff = Math.min(opts.code.amountOffPaise, afterLaunch);
  }
  const floor = Math.min(MIN_ORDER_PAISE, base);
  const total = Math.max(floor, base - launchOff - codeOff);
  // when the floor bites, give back the code discount first, then the launch
  // one, so base − launch − code always equals what is charged
  let excess = total - (base - launchOff - codeOff);
  const giveCode = Math.min(excess, codeOff);
  codeOff -= giveCode;
  excess -= giveCode;
  launchOff -= Math.min(excess, launchOff);
  return {
    packageId: opts.pkg.id,
    listeners: opts.pkg.listeners,
    basePaise: base,
    launchOffPaise: launchOff,
    codeOffPaise: codeOff,
    totalPaise: total,
  };
}

/** Listeners still sellable this window, given what active campaigns still owe. */
export function remainingCapacity(config: PromotionConfig, owedListeners: number): number {
  return Math.max(0, config.capacityListeners - owedListeners);
}

// ------------------------------------------------------------------ Razorpay

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checkout's success callback: hmac_sha256(order_id + "|" + payment_id, key_secret). */
export async function paymentSignatureValid(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return sameString(await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature.trim().toLowerCase());
}

/** Webhooks: hmac_sha256(raw body, webhook secret) in X-Razorpay-Signature. */
export async function webhookSignatureValid(rawBody: string, signature: string, webhookSecret: string): Promise<boolean> {
  if (!signature || !webhookSecret) return false;
  return sameString(await hmacSha256Hex(webhookSecret, rawBody), signature.trim().toLowerCase());
}

// ------------------------------------------------------------------ delivery

/**
 * May this listener be dealt a promoted card right now? The client decides
 * "every N cards"; this is the part a listener can't game by reinstalling.
 */
export function mayDeal(opts: { enabled: boolean; dealtToday: number; perListenerDaily: number }): boolean {
  return opts.enabled && opts.perListenerDaily > 0 && opts.dealtToday < opts.perListenerDaily;
}

/** A listen counts once per listener per campaign, and only from 3 seconds. */
export const COUNTED_LISTEN_MS = 3_000;

export function countsAsListen(playedMs: number, alreadyCounted: boolean): boolean {
  return !alreadyCounted && Number.isFinite(playedMs) && playedMs >= COUNTED_LISTEN_MS;
}

/** Undelivered listeners, refunded pro rata. Rounded down: never refund more than was paid. */
export function refundFor(paidPaise: number, listeners: number, delivered: number): number {
  if (listeners <= 0 || paidPaise <= 0) return 0;
  const undelivered = Math.max(0, listeners - Math.max(0, delivered));
  return Math.floor((paidPaise * undelivered) / listeners);
}

export type CampaignStats = { listens: number; saves: number; skips: number; more: number; never: number };

/** Share of listens that ended in a save — the number an artist actually cares about. */
export function saveRate(s: CampaignStats): number {
  return s.listens > 0 ? Math.round((s.saves / s.listens) * 1000) / 10 : 0;
}
