/**
 * The web app's addresses, without the "#".
 *
 * Routes used to live in the hash (app.hookedcue.com/#/profile) because that
 * works on any static host. The host serves index.html for every path, so the
 * addresses can be plain paths now — /profile, /admin, /settings/data — and
 * old #/ links (already sitting in people's inboxes) are rewritten on load.
 */

export type View =
  | "home"
  | "discover"
  | "profile"
  | "settings"
  | `settings:${string}`
  | `library:${string}`;

export type Route =
  | { kind: "app"; view: View }
  | { kind: "join"; email: string }
  | { kind: "reset"; token: string | null; error: string | null }
  | { kind: "admin" }
  | { kind: "creator" }
  | { kind: "notfound" };

const clean = (path: string) => (path.replace(/\/+$/, "") || "/").toLowerCase();

export function routeFor(pathname: string, search = ""): Route {
  const params = new URLSearchParams(search);
  const raw = pathname.replace(/\/+$/, "") || "/";
  const path = clean(pathname);
  if (path === "/" || path === "/home") return { kind: "app", view: "home" };
  if (path === "/discover") return { kind: "app", view: "discover" };
  if (path === "/profile") return { kind: "app", view: "profile" };
  if (path === "/settings") return { kind: "app", view: "settings" };
  if (path === "/join")
    return { kind: "join", email: params.get("email") ?? "" };
  if (path === "/reset-password")
    return {
      kind: "reset",
      token: params.get("token"),
      error: params.get("error"),
    };
  if (path === "/admin" || path.startsWith("/admin/")) return { kind: "admin" };
  if (path === "/creator" || path.startsWith("/creator/"))
    return { kind: "creator" };
  const settings = /^\/settings\/([a-z-]+)$/.exec(path);
  if (settings) return { kind: "app", view: `settings:${settings[1]}` };
  // library ids are case-sensitive (pl:<convex id>), so read them from the raw path
  const library = /^\/library\/([^/]+)$/i.exec(raw);
  if (library)
    return { kind: "app", view: `library:${decodeURIComponent(library[1])}` };
  return { kind: "notfound" };
}

export function pathForView(view: View): string {
  if (view === "home") return "/";
  if (view.startsWith("settings:"))
    return `/settings/${view.slice("settings:".length)}`;
  if (view.startsWith("library:"))
    return `/library/${encodeURIComponent(view.slice("library:".length))}`;
  return `/${view}`;
}

/**
 * The path an old "#/…" address means, or null when there is no hash route.
 * A reset link built on the old scheme arrives as "#/?token=…", which is a
 * password reset.
 */
export function pathFromLegacyHash(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const rest = hash.slice(1);
  const q = rest.indexOf("?");
  const path = q >= 0 ? rest.slice(0, q) : rest;
  const search = q >= 0 ? rest.slice(q) : "";
  if ((path === "/" || path === "") && /[?&]token=/.test(search))
    return `/reset-password${search}`;
  return `${path || "/"}${search}`;
}
