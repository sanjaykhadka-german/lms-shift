"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitPinAction, type SubmitPinState } from "./actions";

const INITIAL: SubmitPinState = { status: "idle" };
const PIN_LENGTH = 4;

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
  const [state, formAction] = useActionState(submitPinAction, INITIAL);
  const [pin, setPin] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-clear the entered PIN after any non-idle result so the next user
  // starts from blank. Without this the failed PIN would linger in the
  // input until they manually cleared it.
  useEffect(() => {
    if (state.status === "error" || state.status === "locked") {
      setPin("");
    }
  }, [state]);

  // Auto-submit the instant the 4th digit lands — no "Enter" tap needed. On a
  // wrong PIN the effect above resets pin to "" (length ≠ 4, so this won't
  // re-fire); on success the server action redirects. No submit loop.
  useEffect(() => {
    if (pin.length === PIN_LENGTH && state.status !== "locked") {
      formRef.current?.requestSubmit();
    }
  }, [pin, state.status]);

  const handleDigit = (d: string) => {
    setPin((p) => (p.length >= PIN_LENGTH ? p : p + d));
  };
  const handleBack = () => setPin((p) => p.slice(0, -1));
  const handleClear = () => setPin("");

  // Hardware-keyboard support. Many kiosks run on a laptop where typing the
  // PIN on the physical number row is far quicker than tapping. Number keys
  // (top row or numpad) enter digits, Backspace deletes, Escape clears.
  // Ignored while locked so it can't hammer the rate limiter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (state.status === "locked") return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setPin((p) => (p.length >= PIN_LENGTH ? p : p + e.key));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
      } else if (e.key === "Escape") {
        setPin("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.status]);

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

      <PinDots length={PIN_LENGTH} entered={pin.length} />

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

      <div className="grid w-full grid-cols-3 gap-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadButton key={d} onClick={() => handleDigit(d)}>
            {d}
          </PadButton>
        ))}
        <PadButton onClick={handleClear} secondary>
          Clear
        </PadButton>
        <PadButton onClick={() => handleDigit("0")}>0</PadButton>
        <PadButton
          onClick={handleBack}
          secondary
          aria-label="Backspace"
        >
          ⌫
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
  entered,
}: {
  length: number;
  entered: number;
}) {
  return (
    <div className="flex items-center gap-4" aria-label={`PIN: ${entered} of ${length} digits`}>
      {Array.from({ length }).map((_, i) => (
        <span
          key={i}
          className={
            i < entered
              ? "h-4 w-4 rounded-full bg-[#f4eee3]"
              : "h-4 w-4 rounded-full border-2 border-[rgba(244,238,227,0.3)] bg-transparent"
          }
        />
      ))}
    </div>
  );
}

function PadButton({
  children,
  onClick,
  secondary,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  secondary?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      // touch-manipulation removes the ~300ms double-tap-zoom delay that makes
      // taps feel dropped; select-none + transparent tap-highlight stop a quick
      // tap from being swallowed by text selection on a tablet. active:scale
      // gives an instant press confirmation.
      className={
        secondary
          ? "h-24 touch-manipulation select-none rounded-xl bg-[rgba(244,238,227,0.08)] text-lg font-medium text-[#a89c8c] transition-transform [-webkit-tap-highlight-color:transparent] active:scale-95 active:bg-[rgba(244,238,227,0.12)]"
          : "h-24 touch-manipulation select-none rounded-xl bg-[rgba(244,238,227,0.04)] text-4xl font-semibold text-[#f4eee3] ring-1 ring-[rgba(244,238,227,0.13)] transition-transform [-webkit-tap-highlight-color:transparent] active:scale-95 active:bg-[rgba(244,238,227,0.08)]"
      }
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
