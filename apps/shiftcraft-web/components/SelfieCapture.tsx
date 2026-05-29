"use client";

import { useEffect, useRef, useState } from "react";

// AUDIT.md #7b — reusable webcam selfie capture for clock-in flows.
// Mirrors the kiosk's SelfieModal (apps/shiftcraft-web/app/kiosk/me/_punch.tsx)
// but with theme-neutral styling so the same component drops cleanly
// into /app/clock. Three exit paths:
//   - onCapture(dataUrl) : image captured + base64'd
//   - onSkip()           : user closed without capturing → server tags
//                          the photo row selfieStatus='denied'
//   - onCancel()         : user backed out, NO punch should fire

interface Props {
  title?: string;
  onCapture: (dataUrl: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function SelfieCapture({
  title = "Quick selfie",
  onCapture,
  onSkip,
  onCancel,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 320, height: 240 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
          setReady(true);
        }
      } catch (err) {
        setError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera permission blocked."
            : "Camera unavailable.",
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function snap() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      onSkip();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onSkip();
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    onCapture(dataUrl);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Quick selfie attached to this punch — a fraud-deterrent your
            manager can review in the timesheet audit pane.
          </p>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-black">
          {error ? (
            <div className="flex aspect-[4/3] items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {error}
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full object-cover"
            />
          )}
        </div>
        {error ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md bg-[var(--warn)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--warn)]"
            >
              Punch anyway
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground hover:bg-muted/70"
            >
              Skip
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={snap}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Take photo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
