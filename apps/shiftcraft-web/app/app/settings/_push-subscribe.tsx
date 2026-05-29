"use client";

import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  subscribePushAction,
  unsubscribePushAction,
  type FormState,
} from "./push-actions";

// VAPID public key is base64url; PushManager.subscribe wants the raw
// bytes as a BufferSource backed by a plain ArrayBuffer (not the
// generic ArrayBufferLike that `new Uint8Array(n)` infers under
// TS 5.7+). Allocating the buffer explicitly pins the type so this
// can pass to applicationServerKey without a cast.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

type Status = "unsupported" | "default" | "denied" | "subscribed" | "loading";

export function PushSubscribeButton({
  vapidPublicKey,
}: {
  vapidPublicKey: string;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const existing = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) {
          if (existing) {
            setEndpoint(existing.endpoint);
            setStatus("subscribed");
          } else {
            setStatus(Notification.permission as Status);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("default");
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setError(null);
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }
      const reg =
        (await navigator.serviceWorker.getRegistration("/")) ??
        (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Subscription returned no keys");
      }
      const fd = new FormData();
      fd.append("endpoint", json.endpoint);
      fd.append("p256dh", json.keys.p256dh);
      fd.append("auth", json.keys.auth);
      fd.append("userAgent", navigator.userAgent.slice(0, 500));
      const result: FormState = await subscribePushAction(
        { status: "idle" },
        fd,
      );
      if (result.status === "error") {
        await sub.unsubscribe().catch(() => undefined);
        throw new Error(result.message);
      }
      setEndpoint(json.endpoint);
      setStatus("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription failed");
      setStatus("default");
    }
  }

  async function handleDisable() {
    if (!endpoint) return;
    setError(null);
    setStatus("loading");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const existing = reg ? await reg.pushManager.getSubscription() : null;
      if (existing) await existing.unsubscribe();
      const fd = new FormData();
      fd.append("endpoint", endpoint);
      await unsubscribePushAction(fd);
      setEndpoint(null);
      setStatus("default");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unsubscribe failed");
      setStatus("subscribed");
    }
  }

  if (status === "unsupported") {
    return (
      <p className="text-xs text-muted-foreground">
        This browser doesn&rsquo;t support push notifications.
      </p>
    );
  }
  if (status === "denied") {
    return (
      <p className="text-xs text-[color:var(--destructive)]">
        Notifications are blocked. Re-enable them in your browser
        settings, then refresh this page.
      </p>
    );
  }
  if (status === "loading") {
    return <p className="text-xs text-muted-foreground">Checking…</p>;
  }
  if (status === "subscribed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-[var(--live)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
          Enabled on this device
        </span>
        <Button onClick={handleDisable} size="sm" variant="outline">
          Disable
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleEnable} size="sm">
        Enable push notifications
      </Button>
      {error && (
        <p className="text-xs text-[color:var(--destructive)]">{error}</p>
      )}
    </div>
  );
}
