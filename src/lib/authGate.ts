/**
 * Where a signed-in listener is on the way to having a profile.
 *
 * Two clocks run after sign-in: Better Auth has a session almost at once, but
 * the Convex client only carries it after it has fetched a token. Creating the
 * profile on the first clock sent the mutation unauthenticated; it failed, the
 * failure didn't look like an access decision so nobody retried, and a brand
 * new account had no profile — nothing synced — until the page was reloaded.
 */
export type ProfileCheck = "signed-out" | "waiting" | "ready";

export function profileCheck(hasSession: boolean, backendAuthed: boolean): ProfileCheck {
  if (!hasSession) return "signed-out";
  return backendAuthed ? "ready" : "waiting";
}
