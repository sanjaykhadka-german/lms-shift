// Tracey LMS service worker — minimal install-eligibility + offline shell.
//
// Strategy:
//   - Pre-cache /offline + the icons + the wordmark on install.
//   - Cache-first for hashed Next static assets and brand images.
//   - Network-first for HTML navigations, falling back to cache, then /offline.
//   - Pass-through for everything else (and never touch /api/* or cross-origin).
// Bump CACHE when this file changes so old clients drop their stale shell.

// On localhost we never want a SW: Turbopack rotates /_next/static chunk
// hashes on every edit, and cache-first matches on the old hashes yield
// "module factory not available" runtime errors. RegisterServiceWorker.tsx
// already unregisters in dev, but its useEffect can't run if hydration
// fails first — so guard at the SW layer as belt-and-braces. Any SW that
// somehow gets installed on localhost (e.g. from a prior `next start` run)
// unregisters itself, drops its caches, and reloads open clients.
const isLocalhost =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

if (isLocalhost) {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      self.registration
        .unregister()
        .then(() => caches.keys())
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)))
        .catch(() => undefined),
    );
  });
}

const CACHE = "tracey-v1";
const PRECACHE_URLS = [
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/tracey-wordmark.png",
];

self.addEventListener("install", (event) => {
  if (isLocalhost) return;
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache
              .add(new Request(url, { cache: "reload" }))
              .catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  if (isLocalhost) return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (isLocalhost) return;
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for HTML navigations.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          const offline = await cache.match("/offline");
          if (offline) return offline;
          return new Response("Offline", {
            status: 503,
            statusText: "Offline",
            headers: { "Content-Type": "text/plain" },
          });
        }
      })(),
    );
    return;
  }

  // Cache-first for hashed static assets and brand images.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/tracey-wordmark.png";
  if (isStatic) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          if (cached) return cached;
          throw new Error("network and cache both unavailable");
        }
      })(),
    );
  }
});
