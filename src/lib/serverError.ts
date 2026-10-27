/**
 * The words a backend refusal means to show.
 *
 * Convex Cloud's production deployments redact a thrown `Error` to
 * "[Request ID: …] Server Error" before it reaches the browser; only a
 * `ConvexError` carries its payload across (as `.data`). Every user-facing
 * refusal on the server is a ConvexError for that reason (checked on prod,
 * 28 Oct 2026: the access gate's ACCESS_PENDING / EMAIL_UNVERIFIED codes never
 * arrived, so a new account that hadn't confirmed its email saw an app that
 * silently synced nothing).
 *
 * Dev deployments put the text in the message instead ("Uncaught ConvexError:
 * …" or "Uncaught Error: …"), so both shapes are read here.
 */
export function serverMessage(err: unknown, fallback = "Something went wrong. Try again?"): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
      return (data as { message: string }).message;
    }
  }
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const uncaught = /Uncaught (?:Convex)?Error: ([^\n]+)/.exec(raw);
  if (uncaught) return uncaught[1].trim();
  const cleaned = raw.replace(/^\[Request ID: [^\]]*\]\s*/, "").split("\n")[0].trim();
  if (!cleaned || /^Server Error$/i.test(cleaned)) return fallback;
  return cleaned;
}
