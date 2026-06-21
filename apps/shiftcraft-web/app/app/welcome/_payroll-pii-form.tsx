"use client";

import { useActionState, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  selfSavePayrollPiiAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

interface Flags {
  hasTfn: boolean;
  hasBsb: boolean;
  hasAccount: boolean;
  hasSuper: boolean;
  superFundName: string | null;
  bankAccountName: string | null;
  declaration: {
    residency: string | null;
    payBasis: string | null;
    claimTaxFreeThreshold: boolean;
    hasStudyLoan: boolean;
  } | null;
  eligibility: { workVisa: string | null; superEligible: boolean } | null;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]";

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p className="text-xs text-[color:var(--destructive)]">{errors[0]}</p>
  );
}

export function PayrollPiiForm({ flags }: { flags: Flags }) {
  const [state, formAction, pending] = useActionState(
    selfSavePayrollPiiAction,
    initial,
  );
  // Per-field messages from the server action's Zod validation, so
  // "Please fix the highlighted fields" actually points at the bad field.
  const fieldErrors =
    state.status === "error" ? state.fieldErrors : undefined;
  const [showForm, setShowForm] = useState(
    !(flags.hasTfn && flags.hasBsb && flags.hasAccount && flags.hasSuper),
  );

  if (!showForm) {
    return (
      <div className="rounded-md border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] p-3 text-xs">
        <p className="font-medium text-[var(--live)]">
          Payroll details on file
        </p>
        <p className="mt-1 text-[var(--live)]">
          TFN, BSB + account, super fund all stored (encrypted).
          {flags.superFundName ? ` Super fund: ${flags.superFundName}.` : ""}
        </p>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-2 underline text-[var(--live)]"
        >
          Update / change
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="tfn">
          TFN
          {flags.hasTfn && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--live)]">
              on file
            </span>
          )}
        </Label>
        <Input
          id="tfn"
          name="tfn"
          inputMode="numeric"
          autoComplete="off"
          placeholder={flags.hasTfn ? "Leave blank to keep" : "xxx xxx xxx"}
        />
        <FieldError errors={fieldErrors?.tfn} />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="bankAccountName">Account name</Label>
        <Input
          id="bankAccountName"
          name="bankAccountName"
          defaultValue={flags.bankAccountName ?? ""}
          placeholder="Name on the bank account"
          maxLength={120}
        />
        <FieldError errors={fieldErrors?.bankAccountName} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bsb">
          BSB
          {flags.hasBsb && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--live)]">
              on file
            </span>
          )}
        </Label>
        <Input
          id="bsb"
          name="bsb"
          inputMode="numeric"
          autoComplete="off"
          placeholder={flags.hasBsb ? "Leave blank to keep" : "xxx-xxx"}
        />
        <FieldError errors={fieldErrors?.bsb} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="accountNumber">
          Account number
          {flags.hasAccount && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--live)]">
              on file
            </span>
          )}
        </Label>
        <Input
          id="accountNumber"
          name="accountNumber"
          inputMode="numeric"
          autoComplete="off"
          placeholder={
            flags.hasAccount ? "Leave blank to keep" : "4–12 digits"
          }
        />
        <FieldError errors={fieldErrors?.accountNumber} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="superFundName">Super fund name</Label>
        <Input
          id="superFundName"
          name="superFundName"
          defaultValue={flags.superFundName ?? ""}
          placeholder="e.g. Australian Super"
          maxLength={120}
        />
        <FieldError errors={fieldErrors?.superFundName} />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="superMemberNumber">
          Super member number
          {flags.hasSuper && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--live)]">
              on file
            </span>
          )}
        </Label>
        <Input
          id="superMemberNumber"
          name="superMemberNumber"
          autoComplete="off"
          placeholder={flags.hasSuper ? "Leave blank to keep" : "Member ID"}
        />
        <FieldError errors={fieldErrors?.superMemberNumber} />
      </div>

      {/* ── ATO TFN declaration ── */}
      <div className="space-y-1.5">
        <Label htmlFor="residency">Residency for tax</Label>
        <select
          id="residency"
          name="residency"
          defaultValue={flags.declaration?.residency ?? ""}
          className={selectClass}
        >
          <option value="">Select…</option>
          <option value="resident">Australian resident</option>
          <option value="foreign">Foreign resident</option>
          <option value="working_holiday">Working holiday maker</option>
        </select>
        <FieldError errors={fieldErrors?.residency} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payBasis">Basis of payment</Label>
        <select
          id="payBasis"
          name="payBasis"
          defaultValue={flags.declaration?.payBasis ?? ""}
          className={selectClass}
        >
          <option value="">Select…</option>
          <option value="full_time">Full time</option>
          <option value="part_time">Part time</option>
          <option value="casual">Casual</option>
          <option value="labour_hire">Labour hire</option>
        </select>
        <FieldError errors={fieldErrors?.payBasis} />
      </div>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="claimTaxFreeThreshold"
          defaultChecked={flags.declaration?.claimTaxFreeThreshold ?? false}
          className="h-4 w-4 accent-[var(--accent-deep)]"
        />
        Claim the tax-free threshold
      </label>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="hasStudyLoan"
          defaultChecked={flags.declaration?.hasStudyLoan ?? false}
          className="h-4 w-4 accent-[var(--accent-deep)]"
        />
        I have a HELP / VSL / SSL or other study/training loan
      </label>

      {/* ── Work eligibility ── */}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="workVisa">Right to work in Australia</Label>
        <select
          id="workVisa"
          name="workVisa"
          defaultValue={flags.eligibility?.workVisa ?? ""}
          className={selectClass}
        >
          <option value="">Select…</option>
          <option value="citizen_or_pr">
            Australian citizen / permanent resident
          </option>
          <option value="yes_attached">Valid work visa (uploaded below)</option>
          <option value="no">No</option>
        </select>
        <FieldError errors={fieldErrors?.workVisa} />
      </div>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="superEligible"
          defaultChecked={flags.eligibility?.superEligible ?? false}
          className="h-4 w-4 accent-[var(--accent-deep)]"
        />
        I'm eligible for superannuation
      </label>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save payroll details"}
        </Button>
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="text-xs text-muted-foreground underline"
        >
          Skip for now
        </button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
