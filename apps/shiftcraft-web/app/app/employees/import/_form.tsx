"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { importEmployeesAction, type ImportState } from "./_actions";

const INITIAL: ImportState = { status: "idle" };

const STATUS_TONE: Record<string, string> = {
  created: "bg-[var(--live)] text-white",
  skipped: "bg-[var(--warn)] text-white",
  errored: "bg-[var(--danger)] text-white",
};

export function ImportForm() {
  const [state, formAction] = useActionState(importEmployeesAction, INITIAL);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor="csv-file"
            className="block text-xs font-medium text-muted-foreground"
          >
            CSV file (max 2 MB)
          </label>
          <input
            id="csv-file"
            name="file"
            type="file"
            required
            accept=".csv,text/csv"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="sendInvites"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span>
            Email an account-setup link to everyone with an address
            <span className="block text-xs text-muted-foreground">
              Skips anyone already a member or already invited. Rows without an
              email are added to the roster but not invited.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          <SubmitButton />
          {state.status === "error" ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          ) : null}
        </div>
      </form>

      {state.status === "ok" ? (
        <ImportResult state={state} />
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Importing…" : "Import"}
    </Button>
  );
}

function ImportResult({
  state,
}: {
  state: Extract<ImportState, { status: "ok" }>;
}) {
  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Created"
          value={state.createdCount}
          tone={state.createdCount > 0 ? "emerald" : "muted"}
        />
        <StatCard
          label="Skipped"
          value={state.skippedCount}
          tone={state.skippedCount > 0 ? "amber" : "muted"}
        />
        <StatCard
          label="Errored"
          value={state.erroredCount}
          tone={state.erroredCount > 0 ? "rose" : "muted"}
        />
      </div>

      {typeof state.invitesSent === "number" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            label="Invites sent"
            value={state.invitesSent}
            tone={state.invitesSent > 0 ? "emerald" : "muted"}
          />
          <StatCard
            label="Invites skipped"
            value={state.invitesSkipped ?? 0}
            tone={(state.invitesSkipped ?? 0) > 0 ? "amber" : "muted"}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Row-by-row results</h2>
          <Link
            href="/app/people/team"
            className="text-xs text-primary hover:underline"
          >
            Go to Team members →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Row</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {state.outcomes.map((o) => (
                <tr key={o.rowNumber}>
                  <td className="px-4 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                    {o.rowNumber}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {o.fullName ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {o.email ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[o.status]}`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {o.reason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "muted";
}) {
  const cls =
    tone === "emerald"
      ? "border-[color-mix(in_srgb,var(--live)_40%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] text-[var(--live)]"
      : tone === "amber"
        ? "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] text-[var(--warn)]"
        : tone === "rose"
          ? "border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]"
          : "border-border bg-card text-muted-foreground";
  return (
    <div className={`rounded-lg border px-4 py-3 ${cls}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider">{label}</div>
    </div>
  );
}
