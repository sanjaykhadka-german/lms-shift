"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitPinAction, type SubmitPinState } from "./actions";

const INITIAL: SubmitPinState = { status: "idle" };
const PIN_LENGTH = 4;

export function KioskNumpad() {
  const [state, formAction] = useActionState(submitPinAction, INITIAL);
  const [pin, setPin] = useState("");

  // Auto-clear the entered PIN after any non-idle result so the next user
  // starts from blank. Without this the failed PIN would linger in the
  // input until they manually cleared it.
  useEffect(() => {
    if (state.status === "error" || state.status === "locked") {
      setPin("");
    }
  }, [state]);

  const handleDigit = (d: string) => {
    setPin((p) => (p.length >= PIN_LENGTH ? p : p + d));
  };
  const handleBack = () => setPin((p) => p.slice(0, -1));
  const handleClear = () => setPin("");

  const message =
    state.status === "error"
      ? state.message
      : state.status === "locked"
        ? `Too many wrong PINs. Try again in ${state.resetInSec}s.`
        : null;

  return (
    <form
      action={formAction}
      className="mx-auto flex w-full max-w-sm flex-col items-center gap-6"
    >
      <input type="hidden" name="pin" value={pin} />

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

      <div className="grid w-full grid-cols-3 gap-3">
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

      <SubmitRow disabled={pin.length !== PIN_LENGTH || state.status === "locked"} />
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
      className={
        secondary
          ? "h-20 rounded-xl bg-[rgba(244,238,227,0.08)] text-base font-medium text-[#a89c8c] active:bg-[rgba(244,238,227,0.12)]"
          : "h-20 rounded-xl bg-[rgba(244,238,227,0.04)] text-3xl font-semibold text-[#f4eee3] ring-1 ring-[rgba(244,238,227,0.13)] active:bg-[rgba(244,238,227,0.08)]"
      }
      {...rest}
    >
      {children}
    </button>
  );
}

function SubmitRow({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-40"
    >
      {pending ? "Checking…" : "Enter"}
    </button>
  );
}
