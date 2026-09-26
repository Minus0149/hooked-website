/**
 * The last known staff status of the signed-in account.
 *
 * The profile's "Open admin dashboard" button and the settings' Admin row read
 * library.getLibrary, which is undefined for a moment every time the app
 * mounts — and coming back from the dashboard remounts it — so the button
 * vanished and, when the backend was slow, stayed gone (Minus, 2026-09-26).
 * This remembers the answer per account so the button holds steady while the
 * query reloads. It only decides what to show: every admin action is still
 * checked on the server.
 */
const KEY = "hooked.staff.v1";

export type Staff = { isAdmin: boolean; staff: boolean };
type Store = Pick<Storage, "getItem" | "setItem">;

export function readStaff(storage: Store | null, uid: string | null | undefined): Staff {
  const none = { isAdmin: false, staff: false };
  if (!storage || !uid) return none;
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? "null") as ({ uid: string } & Staff) | null;
    return v && v.uid === uid ? { isAdmin: v.isAdmin === true, staff: v.staff === true } : none;
  } catch {
    return none;
  }
}

export function writeStaff(storage: Store | null, uid: string | null | undefined, s: Staff): void {
  if (!storage || !uid) return;
  try {
    storage.setItem(KEY, JSON.stringify({ uid, isAdmin: s.isAdmin, staff: s.staff }));
  } catch {
    /* private mode: the button just waits for the query, as before */
  }
}

/** The live answer when there is one, the remembered one while it loads. */
export function staffNow(
  library: { isAdmin: boolean; permissions?: string[] } | null | undefined,
  remembered: Staff,
): Staff {
  if (!library) return remembered;
  return { isAdmin: library.isAdmin, staff: library.isAdmin || (library.permissions?.length ?? 0) > 0 };
}

export function browserStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
