"use client";

import { useEffect } from "react";

// In production: register /sw.js so the app is installable offline.
// In development: forcibly *unregister* any existing SW and wipe its caches.
// Turbopack rotates /_next/static chunk hashes on every code edit, so a
// cache-first SW from a prior session yields "module factory not available"
// runtime errors when the new HTML references chunks that no longer exist.
const ENABLED = process.env.NODE_ENV === "production";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (!ENABLED) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined);
      if ("caches" in window) {
        void caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => undefined);
      }
      return;
    }

    // Production: defer past first paint so we don't compete with hydration.
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);
    };
    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);
  return null;
}
