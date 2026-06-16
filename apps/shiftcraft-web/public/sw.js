// ShiftCraft web-push service worker (AUDIT.md #12).
//
// Lives at the site root so the default scope ('/') applies and the
// browser can dispatch push events into it. Two event handlers:
//
//   - 'push': render a notification from the JSON payload.
//   - 'notificationclick': focus or open the configured actionUrl.
//
// No build pipeline — this is plain ES2020 and is served as-is from
// /public. Keep it tiny and dependency-free; Next 16's bundling
// doesn't touch /public.

self.addEventListener("install", () => {
  // Activate immediately on first install so the user doesn't need
  // to reload before push events start firing.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of already-open pages so they can dispatch push
  // events without a refresh.
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch handler. We don't cache (the kiosk needs live data), but
// registering a fetch listener lets the browser treat the app as an
// installable PWA ("Add to home screen" / Install).
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "ShiftCraft", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "ShiftCraft";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon.svg",
    badge: payload.badge || "/icon.svg",
    data: { actionUrl: payload.actionUrl || "/" },
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.actionUrl) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Prefer focusing an existing app tab over opening a new one.
      for (const w of windows) {
        const url = new URL(w.url);
        if (url.origin === self.location.origin) {
          w.focus();
          if ("navigate" in w) return w.navigate(targetUrl);
          return undefined;
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
