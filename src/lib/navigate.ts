import type { MouseEvent } from "react";

/**
 * Move to another address without reloading the page. The app and the
 * dashboards are one page: a full reload between them rebuilt the backend
 * connection and the login from scratch, and the admin button waited on it.
 * App (and Shell) listen for popstate, so they re-route.
 */
export function navigate(path: string): void {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** onClick for an <a href>: in-app navigation, but new-tab clicks still open a tab. */
export function inApp(path: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  };
}
