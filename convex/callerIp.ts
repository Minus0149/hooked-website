/**
 * Whose IP a signup is rate limited on.
 *
 * The landing site posts beta signups to /beta from its own server, so the
 * request's own IP is the landing server's, the same for every visitor. Used
 * as the per-IP key, that put every landing signup in one bucket of 30 an hour
 * (each person posts twice: the email, then the optional details): one script
 * could fill it in minutes and every real signup after it failed. The landing
 * now forwards the visitor's IP in the body. The route is guarded by the
 * shared secret, so the forwarded value is the landing's word; anything that
 * doesn't look like an IP falls back to the request's.
 */
export function ingestIp(forwarded: unknown, requestIp: string): string {
  if (typeof forwarded !== "string") return requestIp;
  const ip = forwarded.trim();
  return /^[0-9A-Fa-f:.]{2,64}$/.test(ip) ? ip : requestIp;
}

/**
 * The key a per-IP limit counts under. An IPv6 host is normally handed a whole
 * /64 (2^64 addresses), so keying on the full address gave one machine a fresh
 * allowance per address; the /64 is the unit one subscriber holds. IPv4 and
 * anything unparseable are used as they are.
 */
export function ipRateKey(ip: string): string {
  const raw = ip.trim().toLowerCase();
  if (!raw.includes(":")) return raw;
  const addr = raw.replace(/^\[|\]$/g, "").split("%")[0];
  // an IPv4-mapped address (::ffff:1.2.3.4) is that IPv4 address
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1];
  const halves = addr.split("::");
  if (halves.length > 2) return raw;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return raw;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return raw;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
