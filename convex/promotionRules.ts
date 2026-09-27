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
  // discounts round down to whole rupees, so a price reads ₹50, not ₹49.50
  const wholeRupees = (paise: number) => Math.floor(paise / 100) * 100;
  let launchOff =
    opts.launchOffer.enabled && opts.firstCampaign ? wholeRupees((base * opts.launchOffer.percentOff) / 100) : 0;
  const afterLaunch = base - launchOff;
  let codeOff = 0;
  if (opts.code) {
    if (opts.code.percentOff) codeOff = wholeRupees((afterLaunch * Math.min(opts.code.percentOff, 90)) / 100);
    else if (opts.code.amountOffPaise) codeOff = Math.min(wholeRupees(opts.code.amountOffPaise), afterLaunch);
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

// ------------------------------------------------------------------ requests

/**
 * A promotion starts as a request an admin approves before anything is paid
 * or dealt. The approval fixes the quote; the artist pays that quote within
 * APPROVAL_DAYS or the approval lapses and they ask again.
 *
 *   requested ──approve──▶ approved ──pay──▶ paid (a campaign exists)
 *       │                     │
 *       └──reject──▶ rejected └──lapse──▶ expired
 *   requested/approved ──withdraw──▶ withdrawn
 */
export type RequestStatus = "requested" | "approved" | "rejected" | "paid" | "expired" | "withdrawn";
export type RequestEvent = "approve" | "reject" | "pay" | "lapse" | "withdraw";

export const APPROVAL_DAYS = 7;
export const REQUEST_NOTE_MAX = 500;
export const REJECT_REASON_MAX = 500;

const TRANSITIONS: Record<RequestStatus, Partial<Record<RequestEvent, RequestStatus>>> = {
  requested: { approve: "approved", reject: "rejected", withdraw: "withdrawn" },
  approved: { pay: "paid", lapse: "expired", withdraw: "withdrawn" },
  rejected: {},
  paid: {},
  expired: {},
  withdrawn: {},
};

/** The next status, or null when the event isn't allowed from here. */
export function nextRequestStatus(current: RequestStatus, event: RequestEvent): RequestStatus | null {
  return TRANSITIONS[current][event] ?? null;
}

/** An approval can be paid only while it's approved and inside its window. */
export function approvalPayable(r: { status: RequestStatus; expiresAt?: number }, now: number): boolean {
  return r.status === "approved" && r.expiresAt !== undefined && now <= r.expiresAt;
}

/** A custom package set by the admin at approval: sane numbers or nothing. */
export function customPackage(listeners: number, pricePaise: number): PromotionPackage | null {
  if (!Number.isFinite(listeners) || !Number.isFinite(pricePaise)) return null;
  const l = Math.round(listeners);
  const p = Math.round(pricePaise);
  if (l < 10 || l > 1_000_000 || p < MIN_ORDER_PAISE || p > MAX_ORDER_PAISE) return null;
  return { id: "custom", name: "Custom", listeners: l, pricePaise: p };
}

// ------------------------------------------------------------------ targeting

export type Target = { genres: string[]; moods: string[] };
export type ListenerContext = {
  /** the mood lens on their deck right now, if any */
  mood: string | null;
  /** what they told us they like, plus genres they steered toward */
  genres: string[];
};

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Two genre names mean the same thing if either contains the other ("hiphop" ~ "hip-hop/rap"). */
export function genresOverlap(a: string[], b: string[]): boolean {
  const A = a.map(flat).filter(Boolean);
  const B = b.map(flat).filter(Boolean);
  return A.some((x) => B.some((y) => x.includes(y) || y.includes(x)));
}

/**
 * Does this listener fit the campaign? A listener with a mood lens on only
 * gets songs that fit that mood (`trackFitsLens`, from moodFit) — a promoted
 * ballad must not break a party deck. Beyond that, a campaign aimed at moods
 * wants a listener in one of them, and one aimed at genres wants a listener
 * who likes one. An untargeted campaign fits everyone.
 */
export function targetMatches(target: Target | undefined, listener: ListenerContext, trackFitsLens: boolean): boolean {
  if (listener.mood && !trackFitsLens) return false;
  if (!target) return true;
  const moodOk = target.moods.length === 0 || (listener.mood !== null && target.moods.includes(listener.mood));
  const genreOk = target.genres.length === 0 || genresOverlap(target.genres, listener.genres);
  return moodOk && genreOk;
}

/** How far behind its schedule a campaign may fall before it is dealt to anyone. */
export const TARGETING_SLACK = 0.1;

/** fitsLens: false when the listener has a mood lens on that the song doesn't fit. */
export type Candidate<T> = { item: T; behind: number; matches: boolean; fitsLens?: boolean };

/**
 * The campaign to deal to this listener, or null. Matching campaigns come
 * first, furthest behind schedule first. A campaign that doesn't match is
 * only dealt when its matching audience can't keep up — it has fallen more
 * than TARGETING_SLACK of its window behind a straight-line schedule — so
 * targeting narrows delivery without letting a paid campaign starve. Even
 * then, a listener with a mood lens on never gets a song that doesn't fit it.
 */
export function pickCampaign<T>(cands: Candidate<T>[]): T | null {
  const matching = cands.filter((c) => c.matches).sort((a, b) => b.behind - a.behind);
  if (matching.length > 0) return matching[0].item;
  const starving = cands
    .filter((c) => c.behind > TARGETING_SLACK && c.fitsLens !== false)
    .sort((a, b) => b.behind - a.behind);
  return starving[0]?.item ?? null;
}
