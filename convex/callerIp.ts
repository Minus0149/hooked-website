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
