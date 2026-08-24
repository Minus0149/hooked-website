/*
 * hooked. service worker — deliberately small.
 *
 * Strategy:
 *   - hashed build assets (/assets/…): cache-first. They're content-addressed,
 *     so a hit is always correct and a miss falls through to the network.
 *   - navigations (the SPA shell): network-first with a cache copy as backup,
 *     so updates land immediately but the app still opens offline.
 *   - everything else (Convex, previews, fonts): untouched — streaming audio
 *     through a SW only adds memory on the VPS's clients for zero gain.
 *
 * The precache list is just the offline page; the app shell caches itself on
 * first visit, which keeps this file from ever going stale.
 */
const VERSION = "hooked-v3";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // hashed assets: immutable, so cache-first is always safe
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            const copy = res.clone();
            void caches.open(VERSION).then((c) => c.put(event.request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // app shell / SPA navigations: fresh when online, cached when not
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          void caches.open(VERSION).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(async () =>
          (await caches.match("/index.html")) ??
          (await caches.match(OFFLINE_URL)) ??
          new Response("offline", { status: 503 }),
        ),
    );
  }
});
