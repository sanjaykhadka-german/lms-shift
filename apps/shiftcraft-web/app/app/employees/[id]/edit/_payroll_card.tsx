"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  revealPayrollPiiAction,
  savePayrollPiiAction,
  type PayrollPiiFormState,
  type RevealedPayrollPii,
} from "../../new/actions";
import { Button } from "~/components/ui/button";

interface PayrollPiiCardProps {
  employeeId: string;
  hasTfn: boolean;
  hasBsb: boolean;
  hasAccount: boolean;
  hasSuperMember: boolean;
  superFundName: string | null;
}

const INITIAL: PayrollPiiFormState = { status: "idle" };

export function PayrollPiiCard({
  employeeId,
  hasTfn,
  hasBsb,
  hasAccount,
  hasSuperMember,
  superFundName,
}: PayrollPiiCardProps) {
  const bound = savePayrollPiiAction.bind(null, employeeId);
  const [state, formAction] = useActionState(bound, INITIAL);
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState<RevealedPayrollPii | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [isLoading, startTransition] = useTransition();

  function openEdit() {
    setRevealError(null);
    startTransition(async () => {
      const result = await revealPayrollPiiAction(employeeId);
      if (result.status === "ok") {
        setRevealed(result.data);
        setEditing(true);
      } else {
        setRevealError(result.message);
      }
    });
  }

  function cancelEdit() {
    setEditing(false);
    setRevealed(null);
  }

  // After a successful save, drop the in-memory plaintext and collapse the
  // form. The "Set / Not set" badges will refresh on next page load via
  // revalidatePath inside the action.
  useEffect(() => {
    if (state.status === "ok") {
      setEditing(false);
      setRevealed(null);
    }
  }, [state.status]);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Payroll details</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sensitive identifiers needed for payroll handoff. TFN, BSB,
            account number, and super member number are encrypted at
            rest. Revealing values to edit them is recorded in the audit
            log.
          </p>
          <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
            <PiiRow label="TFN" set={hasTfn} />
            <PiiRow label="BSB" set={hasBsb} />
            <PiiRow label="Account number" set={hasAccount} />
            <PiiRow label="Super member number" set={hasSuperMember} />
            <li className="col-span-full flex items-center gap-2">
              <span className="font-medium text-muted-foreground">
                Super fund:
              </span>{" "}
              {superFundName ? (
                <span>{superFundName}</span>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </li>
          </ul>
        </div>
        {!editing ? (
          <Button
            type="button"
            variant="outline"
            onClick={openEdit}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : "Edit"}
          </Button>
        ) : null}
      </div>

      {revealError ? (
        <p className="mt-3 text-xs text-[color:var(--destructive)]">
          {revealError}
        </p>
      ) : null}

      {editing && revealed ? (
        <form action={formAction} className="mt-4 space-y-3">
          <p className="rounded-md border border-amber-600/30 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Existing values are loaded below. This reveal was recorded in
            the audit log. Leave any field empty to clear it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PiiInput
              name="tfn"
              label="TFN"
              defaultValue={revealed.tfn ?? ""}
              placeholder="123 456 789"
              error={
                state.status === "error" ? state.fieldErrors?.tfn?.[0] : undefined
              }
            />
            <PiiInput
              name="bsb"
              label="BSB"
              defaultValue={revealed.bsb ?? ""}
              placeholder="062-000"
              error={
                state.status === "error" ? state.fieldErrors?.bsb?.[0] : undefined
              }
            />
            <PiiInput
              name="accountNumber"
              label="Account number"
              defaultValue={revealed.accountNumber ?? ""}
              placeholder="12345678"
              error={
                state.status === "error"
                  ? state.fieldErrors?.accountNumber?.[0]
                  : undefined
              }
            />
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">
                Super fund
              </span>
              <input
                name="superFundName"
                type="text"
                defaultValue={superFundName ?? ""}
                placeholder="AustralianSuper"
                autoComplete="off"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <PiiInput
              name="superMemberNumber"
              label="Super member number"
              defaultValue={revealed.superMemberNumber ?? ""}
              placeholder="AS123456"
              error={
                state.status === "error"
                  ? state.fieldErrors?.superMemberNumber?.[0]
                  : undefined
              }
            />
          </div>
          {state.status === "error" ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <SaveButton />
            <Button type="button" variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function PiiRow({ label, set }: { label: string; set: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span className="font-medium text-muted-foreground">{label}:</span>
      {set ? (
        <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">
          Set
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Not set
        </span>
      )}
    </li>
  );
}

function PiiInput({
  name,
  label,
  defaultValue,
  placeholder,
  error,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error ? (
        <span className="text-[color:var(--destructive)]">{error}</span>
      ) : null}
    </label>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}
