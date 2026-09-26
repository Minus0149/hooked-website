/**
 * The backend origins the page is allowed to talk to, read from the same env
 * the client is built with.
 *
 * The policy used to name the self-hosted domain by hand. Moving the backend
 * then produced a build that loaded, rendered, and could not sign anyone in —
 * the CSP refused the fetch and the button spun forever. Deriving the list
 * from VITE_CONVEX_URL / VITE_CONVEX_SITE_URL means the policy cannot point
 * somewhere the client doesn't.
 *
 * Each http(s) origin also gets its ws(s) twin, because the Convex client
 * syncs over a websocket to the same host.
 */
/**
 * Third parties the page fetches directly: the preview CDN (the hook editor
 * decodes a preview to draw its waveform; <audio> playback alone is covered by
 * media-src — a fetch is not), and Razorpay's checkout API and its telemetry,
 * which checkout.js calls from the creator dashboard (docs/PROMOTIONS.md).
 */
export const FETCHED_HOSTS = [
  "https://audio-ssl.itunes.apple.com",
  "https://api.razorpay.com",
  "https://lumberjack.razorpay.com",
];

/**
 * Razorpay Standard Checkout: its script (which loads a risk-check bundle from
 * cdn.razorpay.com), and the iframe it renders the payment page in.
 */
export const CHECKOUT_SCRIPT = "https://checkout.razorpay.com https://cdn.razorpay.com";
export const CHECKOUT_FRAMES = "https://checkout.razorpay.com https://api.razorpay.com";

export function connectSources(env) {
  const out = new Set(["'self'"]);
  for (const key of ["VITE_CONVEX_URL", "VITE_CONVEX_SITE_URL"]) {
    const raw = env[key];
    if (!raw) continue;
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${key} is not a URL: ${raw}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`${key} must be http(s): ${raw}`);
    }
    out.add(url.origin);
    out.add(url.origin.replace(/^http/, "ws"));
  }
  for (const host of FETCHED_HOSTS) out.add(host);
  return [...out].join(" ");
}

export const CONNECT_PLACEHOLDER = "__CONVEX_CONNECT__";
