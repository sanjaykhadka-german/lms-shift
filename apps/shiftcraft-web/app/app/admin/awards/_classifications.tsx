"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveClassificationAction,
  deleteClassificationAction,
  type FormState,
} from "./actions";

const INITIAL: FormState = { status: "idle" };

interface Row {
  id: string;
  awardCode: string;
  levelCode: string;
  label: string;
  baseHourlyRate: number;
  casualLoading: number | null;
  effectiveFrom: string;
  source: string;
}

export function ClassificationsCard({
  awardCode,
  classifications,
  today,
}: {
  awardCode: string;
  classifications: Row[];
  today: string;
}) {
  const sorted = [...classifications].sort(
    (a, b) =>
      a.levelCode.localeCompare(b.levelCode) ||
      b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Classifications · {awardCode}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        One row per level + effective date. Re-saving the same level and date
        edits it. The Fair Work pull adds rows marked <code>fwc</code>.
      </p>

      {sorted.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Level</th>
                <th className="py-1.5 pr-3 font-medium">Label</th>
                <th className="py-1.5 pr-3 font-medium">Base $/h</th>
                <th className="py-1.5 pr-3 font-medium">Casual loading</th>
                <th className="py-1.5 pr-3 font-medium">Effective</th>
                <th className="py-1.5 pr-3 font-medium">Source</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 font-medium">{c.levelCode}</td>
                  <td className="py-1.5 pr-3">{c.label}</td>
                  <td className="py-1.5 pr-3">{c.baseHourlyRate.toFixed(2)}</td>
                  <td className="py-1.5 pr-3">
                    {c.casualLoading != null
                      ? `${(c.casualLoading * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-3">{c.effectiveFrom}</td>
                  <td className="py-1.5 pr-3">{c.source}</td>
                  <td className="py-1.5 text-right">
                    <DeleteButton id={c.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No classifications yet — add one below or pull from Fair Work.
        </p>
      )}

      <AddForm awardCode={awardCode} today={today} />
    </section>
  );
}

function AddForm({ awardCode, today }: { awardCode: string; today: string }) {
  const [state, action] = useActionState(saveClassificationAction, INITIAL);
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form
      action={action}
      className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <input type="hidden" name="awardCode" value={awardCode} />
      <Field name="levelCode" label="Level code" placeholder="L3" error={fe?.levelCode?.[0]} />
      <Field name="label" label="Label" placeholder="Level 3 — Slaughterer" error={fe?.label?.[0]} />
      <Field
        name="baseHourlyRate"
        label="Base hourly rate"
        placeholder="26.55"
        inputMode="decimal"
        error={fe?.baseHourlyRate?.[0]}
      />
      <Field
        name="casualLoading"
        label="Casual loading (0.25 = 25%)"
        placeholder="0.25"
        inputMode="decimal"
        error={fe?.casualLoading?.[0]}
      />
      <Field
        name="effectiveFrom"
        label="Effective from"
        type="date"
        defaultValue={today}
        error={fe?.effectiveFrom?.[0]}
      />
      <div className="flex items-end gap-3">
        <SubmitButton label="Add / update" />
        {state.status === "ok" ? (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        ) : null}
        {state.status === "error" && !fe ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
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
  const [, action] = useActionState(deleteClassificationAction, INITIAL);
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
