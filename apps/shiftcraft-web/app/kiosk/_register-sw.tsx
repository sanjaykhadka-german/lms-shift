"use client";

import { useEffect } from "react";

// Registers the root service worker so the kiosk satisfies PWA install
// criteria (manifest + SW controlling the page). Idempotent — register() is a
// no-op if an equivalent registration already exists (e.g. from push setup).
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // Best-effort: install just won't be offered if registration fails.
      });
  }, []);
  return null;
}
