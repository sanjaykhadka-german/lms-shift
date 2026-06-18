"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveAllowanceAction,
  deleteAllowanceAction,
  type FormState,
} from "./actions";

const INITIAL: FormState = { status: "idle" };

interface Row {
  id: string;
  awardCode: string;
  key: string;
  label: string;
  type: string;
  amount: number;
  taxable: boolean;
  effectiveFrom: string;
  source: string;
}

const TYPE_LABEL: Record<string, string> = {
  flat: "flat / week",
  per_hour: "per hour",
  per_shift: "per shift",
  per_day: "per day",
};

export function AllowancesCard({
  awardCode,
  allowances,
  today,
}: {
  awardCode: string;
  allowances: Row[];
  today: string;
}) {
  const sorted = [...allowances].sort(
    (a, b) =>
      a.key.localeCompare(b.key) ||
      b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Allowances · {awardCode}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Amounts are applied by type when computing pay. ShiftCraft emits the
        allowance total into the payroll <code>allowance</code> category; the
        Xero export maps it onward.
      </p>

      {sorted.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Key</th>
                <th className="py-1.5 pr-3 font-medium">Label</th>
                <th className="py-1.5 pr-3 font-medium">Type</th>
                <th className="py-1.5 pr-3 font-medium">Amount</th>
                <th className="py-1.5 pr-3 font-medium">Taxable</th>
                <th className="py-1.5 pr-3 font-medium">Effective</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 font-medium">{a.key}</td>
                  <td className="py-1.5 pr-3">{a.label}</td>
                  <td className="py-1.5 pr-3">{TYPE_LABEL[a.type] ?? a.type}</td>
                  <td className="py-1.5 pr-3">${a.amount.toFixed(4)}</td>
                  <td className="py-1.5 pr-3">{a.taxable ? "yes" : "no"}</td>
                  <td className="py-1.5 pr-3">{a.effectiveFrom}</td>
                  <td className="py-1.5 text-right">
                    <DeleteButton id={a.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No allowances yet — add one below or pull from Fair Work.
        </p>
      )}

      <AddForm awardCode={awardCode} today={today} />
    </section>
  );
}

function AddForm({ awardCode, today }: { awardCode: string; today: string }) {
  const [state, action] = useActionState(saveAllowanceAction, INITIAL);
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form
      action={action}
      className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <input type="hidden" name="awardCode" value={awardCode} />
      <Field name="key" label="Key" placeholder="meat_tool" error={fe?.key?.[0]} />
      <Field name="label" label="Label" placeholder="Tool allowance" error={fe?.label?.[0]} />
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">Type</span>
        <select
          name="type"
          defaultValue="flat"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="flat">flat / week</option>
          <option value="per_hour">per hour</option>
          <option value="per_shift">per shift</option>
          <option value="per_day">per day</option>
        </select>
      </label>
      <Field
        name="amount"
        label="Amount ($)"
        placeholder="0.78"
        inputMode="decimal"
        error={fe?.amount?.[0]}
      />
      <Field name="effectiveFrom" label="Effective from" type="date" defaultValue={today} error={fe?.effectiveFrom?.[0]} />
      <label className="flex items-center gap-2 self-end text-xs">
        <input type="checkbox" name="taxable" defaultChecked className="h-4 w-4 accent-primary" />
        <span className="font-medium text-muted-foreground">Taxable</span>
      </label>
      <div className="flex items-end gap-3">
        <SubmitButton label="Add / update" />
        {state.status === "ok" ? (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        ) : null}
        {state.status === "error" && !fe ? (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
  inputMode,
  defaultValue,
  error,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  inputMode?: "decimal";
  defaultValue?: string;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error ? (
        <span className="text-[color:var(--destructive)]">{error}</span>
      ) : null}
    </label>
  );
}

function DeleteButton({ id }: { id: string }) {
  const [, action] = useActionState(deleteAllowanceAction, INITIAL);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <DeleteSubmit />
    </form>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs text-muted-foreground hover:text-[color:var(--destructive)] hover:underline disabled:opacity-50"
    >
      {pending ? "…" : "Remove"}
    </button>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}
