"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitPinAction, type SubmitPinState } from "./actions";

const INITIAL: SubmitPinState = { status: "idle" };
const PIN_LENGTH = 4;

// Short haptic tick on every key press. On a budget Galaxy Tab A the panel has
// noticeable touch latency, so an instant vibration is the clearest "your tap
// landed" signal. No-op on desktop / unsupported devices.
function tapFeedback() {
  if (typeof navigator !== "undefined") navigator.vibrate?.(10);
}

export function KioskNumpad({
  appUserId,
  personName,
  onBack,
}: {
  /** When set (name-select flow), the PIN is verified against just this user. */
  appUserId?: string;
  personName?: string;
  onBack?: () => void;
} = {}) {
  const [state, formAction, isPending] = useActionState(
    submitPinAction,
    INITIAL,
  );
  const [pin, setPin] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Visual feedback for the PIN dots: flashIndex briefly enlarges the dot that
  // just filled; peeking shows the most-recent digit as a glyph before masking.
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const [peeking, setPeeking] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLenRef = useRef(0);

  const locked = state.status === "locked";
  // While a submit is in flight, or the device is locked, every entry path is
  // a no-op. This stops round-trip taps (during "Checking…") from being added
  // to the PIN and then wiped by the error reset — which read as "lost" taps.
  const inputBlocked = isPending || locked;

  // Auto-clear the entered PIN after any non-idle result so the next user
  // starts from blank. Without this the failed PIN would linger in the
  // input until they manually cleared it.
  useEffect(() => {
    if (state.status === "error" || state.status === "locked") {
      setPin("");
    }
  }, [state]);

  // Drive the dot flash + last-digit peek off actual pin changes (robust to
  // React batching of rapid taps). A digit added → flash the new dot for 150ms
  // and reveal it for 450ms; a digit removed → cancel both immediately.
  useEffect(() => {
    const prev = prevLenRef.current;
    prevLenRef.current = pin.length;
    if (pin.length > prev && pin.length > 0) {
      const idx = pin.length - 1;
      setFlashIndex(idx);
      setPeeking(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashIndex(null), 150);
      if (peekTimer.current) clearTimeout(peekTimer.current);
      peekTimer.current = setTimeout(() => setPeeking(false), 450);
    } else if (pin.length < prev) {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (peekTimer.current) clearTimeout(peekTimer.current);
      setFlashIndex(null);
      setPeeking(false);
    }
  }, [pin]);

  // Auto-submit the 4th digit — no "Enter" tap needed — but on a ~200ms delay so
  // all four dots and the 4th-dot flash/peek are visible first (kills the "it
  // submitted before I finished" feeling). Backspacing within the window clears
  // the timer (pin length drops, effect re-runs, cleanup cancels), so a quick
  // correction never submits. On a wrong PIN the reset effect blanks pin so this
  // won't re-fire; on success the server action redirects.
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !locked) {
      submitTimer.current = setTimeout(() => {
        formRef.current?.requestSubmit();
      }, 200);
      return () => {
        if (submitTimer.current) clearTimeout(submitTimer.current);
      };
    }
  }, [pin, locked]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (peekTimer.current) clearTimeout(peekTimer.current);
      if (submitTimer.current) clearTimeout(submitTimer.current);
    };
  }, []);

  const handleDigit = (d: string) => {
    if (inputBlocked) return;
    setPin((p) => (p.length >= PIN_LENGTH ? p : p + d));
    tapFeedback();
  };
  const handleBack = () => {
    if (inputBlocked) return;
    setPin((p) => p.slice(0, -1));
    tapFeedback();
  };
  const handleClear = () => {
    if (inputBlocked) return;
    setPin("");
    tapFeedback();
  };

  // Hardware-keyboard support. Many kiosks run on a laptop where typing the
  // PIN on the physical number row is far quicker than tapping. Number keys
  // (top row or numpad) enter digits, Backspace deletes, Escape clears.
  // Ignored while locked or mid-submit so it can't hammer the rate limiter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (inputBlocked) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setPin((p) => (p.length >= PIN_LENGTH ? p : p + e.key));
        tapFeedback();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
        tapFeedback();
      } else if (e.key === "Escape") {
        setPin("");
        tapFeedback();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputBlocked]);

  const message =
    state.status === "error"
      ? state.message
      : state.status === "locked"
        ? `Too many wrong PINs. Try again in ${state.resetInSec}s.`
        : null;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-6"
    >
      <input type="hidden" name="pin" value={pin} />
      {appUserId ? (
        <input type="hidden" name="appUserId" value={appUserId} />
      ) : null}

      {personName ? (
        <div className="text-center">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="mb-1 text-xs text-[#a89c8c] hover:text-[#f4eee3]"
            >
              ← Not you?
            </button>
          ) : null}
          <div className="font-display text-xl font-semibold">
            Hi {personName}
          </div>
        </div>
      ) : null}

      <PinDots
        length={PIN_LENGTH}
        pin={pin}
        flashIndex={flashIndex}
        peeking={peeking}
      />

      {message ? (
        <p
          className={
            state.status === "locked"
              ? "text-sm font-medium text-[color-mix(in_srgb,var(--warn)_60%,white)]"
              : "text-sm font-medium text-[color-mix(in_srgb,var(--danger)_60%,white)]"
          }
          role="status"
        >
          {message}
        </p>
      ) : (
        <p className="text-sm text-[#766b5e]">Enter your 4-digit PIN</p>
      )}

      <div className="grid w-full grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadButton
            key={d}
            onPress={() => handleDigit(d)}
            disabled={inputBlocked}
          >
            {d}
          </PadButton>
        ))}
        <PadButton onPress={handleClear} disabled={inputBlocked} secondary>
          Clear
        </PadButton>
        <PadButton onPress={() => handleDigit("0")} disabled={inputBlocked}>
          0
        </PadButton>
        <PadButton
          onPress={handleBack}
          disabled={inputBlocked}
          secondary
          aria-label="Backspace"
        >
          <span className="text-2xl">⌫</span>
        </PadButton>
      </div>

      {/* No manual submit — the PIN auto-submits on the 4th digit. This
          sr-only button gives requestSubmit() a submitter and keeps native
          form submission working. */}
      <button type="submit" className="sr-only" tabIndex={-1}>
        Enter
      </button>
      <SubmitStatus />
    </form>
  );
}

function PinDots({
  length,
  pin,
  flashIndex,
  peeking,
}: {
  length: number;
  pin: string;
  flashIndex: number | null;
  peeking: boolean;
}) {
  const entered = pin.length;
  return (
    <div
      className="flex items-center gap-4"
      aria-label={`PIN: ${entered} of ${length} digits`}
    >
      {Array.from({ length }).map((_, i) => {
        const filled = i < entered;
        // Reveal only the most-recently entered digit, briefly, then mask it
        // — standard phone-PIN behaviour so users can confirm the right key.
        const showDigit = peeking && filled && i === entered - 1;
        const flashing = i === flashIndex;
        // Fixed-size box per position so peeking a glyph never shifts layout.
        return (
          <span
            key={i}
            className="flex h-7 w-7 items-center justify-center"
          >
            {showDigit ? (
              <span
                className={`text-xl font-semibold text-[#f4eee3] transition-transform ${
                  flashing ? "scale-110" : ""
                }`}
              >
                {pin[i]}
              </span>
            ) : (
              <span
                className={
                  filled
                    ? `h-4 w-4 rounded-full bg-[#f4eee3] transition-transform ${
                        flashing ? "scale-150" : ""
                      }`
                    : "h-4 w-4 rounded-full border-2 border-[rgba(244,238,227,0.3)] bg-transparent"
                }
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

function PadButton({
  children,
  onPress,
  secondary,
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  // Lasting press confirmation: `active:scale-95` only shows while the finger
  // is down — too fleeting on a high-latency panel. We hold a brighter
  // "pressed" state for ~120ms after lift so the user can see the tap landed.
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTs = useRef(0);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  // Drive entry on pointer-down (not click) so response + haptic are immediate.
  // preventDefault stops the synthetic click double-firing. Ignore non-primary
  // pointers and de-dupe duplicate pointerdowns landing <60ms apart (a cheap
  // bounce guard for a flaky budget digitiser).
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    if (disabled) return;
    const now = Date.now();
    if (now - lastTs.current < 60) return;
    lastTs.current = now;
    setPressed(true);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressed(false), 120);
    onPress();
  };

  // Higher-contrast key surface + boundary so edges stay visible through a
  // screen protector and under glare (≥3:1 non-text contrast). touch-manipulation
  // removes the double-tap-zoom delay; select-none + transparent tap-highlight
  // stop a quick tap being swallowed by text selection.
  const base =
    "h-24 touch-manipulation select-none rounded-xl ring-1 transition-transform [-webkit-tap-highlight-color:transparent] active:scale-95";
  const variant = secondary
    ? `text-lg font-medium ${
        pressed
          ? "scale-95 bg-[rgba(244,238,227,0.20)] text-[#f4eee3] ring-[rgba(244,238,227,0.32)]"
          : "bg-[rgba(244,238,227,0.12)] text-[#a89c8c] ring-[rgba(244,238,227,0.18)]"
      }`
    : `text-4xl font-semibold text-[#f4eee3] ${
        pressed
          ? "scale-95 bg-[rgba(244,238,227,0.18)] ring-[rgba(244,238,227,0.40)]"
          : "bg-[rgba(244,238,227,0.10)] ring-[rgba(244,238,227,0.28)]"
      }`;

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      className={`${base} ${variant}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// Pending feedback while the PIN is verified. The PIN auto-submits, so there's
// no button to press — this just shows progress.
function SubmitStatus() {
  const { pending } = useFormStatus();
  // Always render so the form height is constant — mounting/unmounting this
  // line was what made the pad jump when the PIN auto-submitted on the 4th
  // digit. h-5 reserves the text-sm line box; we just toggle the text.
  return (
    <p
      className="h-5 text-sm font-medium text-[#a89c8c]"
      role="status"
      aria-live="polite"
    >
      {pending ? "Checking…" : ""}
    </p>
  );
}
