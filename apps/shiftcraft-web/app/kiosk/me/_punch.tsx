"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { clearActorAction, kioskPunchAction } from "../actions";
import type { ScClockEventType } from "@tracey/db";
import type { ClockStatus } from "~/lib/clock";

export interface PunchScreenProps {
  user: { name: string; image: string | null };
  clockStatus: ClockStatus;
  lastEventType:
    | "in"
    | "out"
    | "break_start"
    | "break_end"
    | null;
  segmentStartedAt: string | null;
  locationName: string;
  todayShift: {
    startsAt: string;
    endsAt: string;
    role: string;
  } | null;
  whosHere: Array<{
    id: string;
    name: string;
    image: string | null;
    since: string;
  }>;
  announcement: { title: string; body: string } | null;
  requireSelfie: boolean;
}

type SelfiePunchType = "in" | "out";
type AnyPunchType = ScClockEventType;

const PUNCH_LABELS: Record<AnyPunchType, string> = {
  in: "Clock in",
  out: "Clock out",
  break_start: "Start break",
  break_end: "End break",
};

function isAllowed(
  status: ClockStatus,
  next: AnyPunchType,
): boolean {
  switch (next) {
    case "in":
      return status === "clocked_out";
    case "out":
      return status === "working" || status === "on_break";
    case "break_start":
      return status === "working";
    case "break_end":
      return status === "on_break";
    default:
      return false;
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PunchScreen(props: PunchScreenProps) {
  const {
    user,
    clockStatus,
    locationName,
    todayShift,
    whosHere,
    announcement,
    requireSelfie,
  } = props;

  // Announcement gate. v1 makes every visit ack the pinned announcement —
  // good enough until per-user reads are tracked (plan's deferred work).
  const [ackd, setAckd] = useState(announcement === null);
  // Which punch (if any) is awaiting a selfie. When non-null, the SelfieModal
  // mounts; on capture or skip, the matching <form> is submitted.
  const [selfieFor, setSelfieFor] = useState<SelfiePunchType | null>(null);

  // One form per event type — bound once with the type as the action's
  // first arg. The selfie modal mutates the chosen form's hidden input
  // then calls requestSubmit().
  const formRefs: Record<
    AnyPunchType,
    React.RefObject<HTMLFormElement | null>
  > = {
    in: useRef<HTMLFormElement>(null),
    out: useRef<HTMLFormElement>(null),
    break_start: useRef<HTMLFormElement>(null),
    break_end: useRef<HTMLFormElement>(null),
  };

  const handlePunchClick = (et: AnyPunchType) => {
    if ((et === "in" || et === "out") && requireSelfie) {
      setSelfieFor(et);
    } else {
      formRefs[et].current?.requestSubmit();
    }
  };

  const handleSelfieDone = (
    targetEvent: SelfiePunchType,
    dataUrl: string,
  ) => {
    const form = formRefs[targetEvent].current;
    if (form) {
      const input = form.querySelector(
        'input[name="selfie"]',
      ) as HTMLInputElement | null;
      if (input) input.value = dataUrl;
      form.requestSubmit();
    }
    setSelfieFor(null);
  };

  // 30-sec idle bounce. The actor cookie has a 60-sec hard cap server-side
  // (see signActorCookie default), but if a user PIN'd in then walked away
  // we want the next person seeing the kiosk to start fresh — not see
  // someone else's name / schedule. Any mouse / key / touch event resets
  // the timer; on expiry we submit the existing clearActorAction form.
  const idleFormRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const IDLE_MS = 30_000;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        idleFormRef.current?.requestSubmit();
      }, IDLE_MS);
    };
    reset();
    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);

  if (!ackd && announcement) {
    return (
      <section className="mx-auto mt-12 w-full max-w-xl space-y-5 rounded-xl border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] p-8 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color-mix(in_srgb,var(--warn)_60%,white)]">
          Pinned announcement
        </div>
        <h2 className="font-display text-xl font-semibold tracking-tight text-[#f4eee3]">
          {announcement.title}
        </h2>
        <p className="whitespace-pre-line text-sm text-[#a89c8c]">
          {announcement.body}
        </p>
        <button
          type="button"
          onClick={() => setAckd(true)}
          className="rounded-md bg-[var(--warn)] px-5 py-2 text-sm font-semibold text-[#17130f] hover:bg-[color-mix(in_srgb,var(--warn)_85%,white)]"
        >
          Got it
        </button>
      </section>
    );
  }

  const statusLabel: Record<ClockStatus, string> = {
    clocked_out: "Not clocked in",
    working: "On shift",
    on_break: "On break",
  };

  return (
    <>
      <header className="flex items-center gap-4 border-b border-[rgba(244,238,227,0.13)] pb-5">
        <Avatar name={user.name} image={user.image} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-semibold tracking-tight">
            Hi {user.name}
          </h1>
          <div className="mt-0.5 text-xs text-[#766b5e]">
            {locationName} ·{" "}
            <span
              className={
                clockStatus === "working"
                  ? "text-[color-mix(in_srgb,var(--live)_55%,white)]"
                  : clockStatus === "on_break"
                    ? "text-[color-mix(in_srgb,var(--warn)_60%,white)]"
                    : "text-[#a89c8c]"
              }
            >
              {statusLabel[clockStatus]}
            </span>
            {props.segmentStartedAt && clockStatus !== "clocked_out"
              ? ` since ${fmtTime(props.segmentStartedAt)}`
              : ""}
          </div>
        </div>
        <form action={clearActorAction}>
          <button
            type="submit"
            className="rounded-md border border-[rgba(244,238,227,0.18)] px-3 py-1.5 text-xs text-[#a89c8c] hover:bg-[rgba(244,238,227,0.08)]"
          >
            Cancel
          </button>
        </form>
      </header>

      {todayShift ? (
        <section className="rounded-lg border border-[rgba(244,238,227,0.13)] bg-[rgba(244,238,227,0.04)] p-4 text-sm">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#766b5e]">
            Your shift today
          </div>
          <div className="mt-1 font-medium">
            {fmtTime(todayShift.startsAt)} – {fmtTime(todayShift.endsAt)} ·{" "}
            {todayShift.role}
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-[rgba(244,238,227,0.13)] bg-[rgba(244,238,227,0.04)] p-4 text-sm text-[#766b5e]">
          No scheduled shift here today.
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(PUNCH_LABELS) as AnyPunchType[]).map((et) => {
          const allowed = isAllowed(clockStatus, et);
          const tone =
            et === "in"
              ? "bg-[var(--live)] hover:bg-[color-mix(in_srgb,var(--live)_85%,white)]"
              : et === "out"
                ? "bg-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_85%,white)]"
                : "bg-[rgba(244,238,227,0.12)] hover:bg-[rgba(244,238,227,0.16)]";
          return (
            <form
              key={et}
              ref={formRefs[et]}
              action={kioskPunchAction.bind(null, et)}
            >
              <input type="hidden" name="selfie" value="" />
              <PunchButton
                disabled={!allowed}
                tone={tone}
                onClick={() => handlePunchClick(et)}
              >
                {PUNCH_LABELS[et]}
              </PunchButton>
            </form>
          );
        })}
      </section>

      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#766b5e]">
          On shift at {locationName} now
        </div>
        {whosHere.length === 0 ? (
          <p className="text-sm text-[#766b5e]">
            Nobody clocked in here yet today.
          </p>
        ) : (
          <ul className="space-y-2">
            {whosHere.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-md border border-[rgba(244,238,227,0.13)] bg-[rgba(244,238,227,0.04)] px-3 py-2"
              >
                <Avatar name={p.name} image={p.image} small />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{p.name}</div>
                </div>
                <div className="text-xs tabular-nums text-[#766b5e]">
                  since {fmtTime(p.since)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selfieFor ? (
        <SelfieModal
          event={selfieFor}
          onCapture={(dataUrl) => handleSelfieDone(selfieFor, dataUrl)}
          onSkip={() => handleSelfieDone(selfieFor, "")}
          onCancel={() => setSelfieFor(null)}
        />
      ) : null}

      {/* Invisible form for the idle-timeout submit. requestSubmit() on this
          triggers clearActorAction without needing to import the server
          action call directly into client code. */}
      <form ref={idleFormRef} action={clearActorAction} className="hidden" />
    </>
  );
}

function PunchButton({
  children,
  disabled,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tone: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={onClick}
      className={`h-20 w-full rounded-xl text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-[rgba(244,238,227,0.08)] disabled:text-[rgba(244,238,227,0.35)] ${tone}`}
    >
      {pending ? "…" : children}
    </button>
  );
}

function Avatar({
  name,
  image,
  small,
}: {
  name: string;
  image: string | null;
  small?: boolean;
}) {
  const cls = small
    ? "h-9 w-9 text-xs"
    : "h-12 w-12 text-base";
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={image}
        alt={name}
        className={`${cls} rounded-full object-cover`}
      />
    );
  }
  const init = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={`${cls} flex items-center justify-center rounded-full bg-[rgba(244,238,227,0.08)] font-semibold text-[#f4eee3]`}
    >
      {init || "?"}
    </span>
  );
}

// Webcam capture with three exit paths: success (dataUrl), skip (no image
// → server marks status='denied'), cancel (don't punch at all).
function SelfieModal({
  event,
  onCapture,
  onSkip,
  onCancel,
}: {
  event: SelfiePunchType;
  onCapture: (dataUrl: string) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
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

  const snap = () => {
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
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <div className="w-full max-w-md space-y-4 rounded-xl border border-[rgba(244,238,227,0.13)] bg-[#17130f] p-6 shadow-2xl">
        <div className="text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#766b5e]">
            {event === "in" ? "Clocking in" : "Clocking out"}
          </div>
          <h3 className="mt-1 font-display text-lg font-semibold">Quick selfie</h3>
        </div>
        <div className="overflow-hidden rounded-md border border-[rgba(244,238,227,0.13)] bg-black">
          {error ? (
            <div className="flex aspect-[4/3] items-center justify-center p-4 text-center text-sm text-[#a89c8c]">
              {error}
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full bg-[rgba(244,238,227,0.04)] object-cover"
            />
          )}
        </div>
        {error ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-[rgba(244,238,227,0.18)] px-4 py-2 text-sm text-[#a89c8c] hover:bg-[rgba(244,238,227,0.08)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md bg-[rgba(244,238,227,0.12)] px-4 py-2 text-sm font-medium text-[#f4eee3] hover:bg-[rgba(244,238,227,0.16)]"
            >
              Punch anyway
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-[rgba(244,238,227,0.18)] px-3 py-2 text-sm text-[#a89c8c] hover:bg-[rgba(244,238,227,0.08)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md bg-[rgba(244,238,227,0.08)] px-3 py-2 text-sm text-[#a89c8c] hover:bg-[rgba(244,238,227,0.12)]"
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
