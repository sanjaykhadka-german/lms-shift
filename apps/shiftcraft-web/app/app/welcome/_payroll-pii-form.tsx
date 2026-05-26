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
}

export function PayrollPiiForm({ flags }: { flags: Flags }) {
  const [state, formAction, pending] = useActionState(
    selfSavePayrollPiiAction,
    initial,
  );
  const [showForm, setShowForm] = useState(
    !(flags.hasTfn && flags.hasBsb && flags.hasAccount && flags.hasSuper),
  );

  if (!showForm) {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-xs dark:border-emerald-500/30 dark:bg-emerald-950/20">
        <p className="font-medium text-emerald-900 dark:text-emerald-200">
          Payroll details on file
        </p>
        <p className="mt-1 text-emerald-800 dark:text-emerald-300">
          TFN, BSB + account, super fund all stored (encrypted).
          {flags.superFundName ? ` Super fund: ${flags.superFundName}.` : ""}
        </p>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-2 underline text-emerald-900 dark:text-emerald-200"
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
            <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-600">
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
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bsb">
          BSB
          {flags.hasBsb && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-600">
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
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="accountNumber">
          Account number
          {flags.hasAccount && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-600">
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
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="superMemberNumber">
          Super member number
          {flags.hasSuper && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-600">
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
      </div>

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
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
