/**
 * Is the backend itself down, or did one function fail?
 *
 * When Convex switches a deployment off (Nov 2026: free plan over its limit)
 * every function answers with the same "[Request ID: …] Server Error" that a
 * single buggy function would give, so the message alone can't tell an outage
 * from a bug. The probe asks for the one thing that never fails on a working
 * backend, the catalogue version, a cheap single-row read. If that fails too,
 * the backend is down and the app shows the maintenance screen instead of the
 * crash screen.
 */

/** The error text Convex gives clients for any failed function. */
export function looksLikeServerError(message: string): boolean {
  return /\bServer Error\b/.test(message);
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** true when the backend can't answer even the catalogue version */
export async function backendDown(convexUrl: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${convexUrl.replace(/\/+$/, "")}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "catalog:version", args: {}, format: "json" }),
    });
    if (!res.ok) return true;
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return body?.status !== "success";
  } catch {
    return true; // offline or unreachable reads the same to the listener
  }
}

/** How often the maintenance screen checks whether the backend is back. */
export const RECHECK_MS = 30_000;
