"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  previewFairWorkAction,
  applyFairWorkAction,
  type FairWorkState,
} from "./actions";

const INITIAL: FairWorkState = { status: "idle" };

export function FairWorkCard({ configured }: { configured: boolean }) {
  const [preview, previewAction] = useActionState(
    previewFairWorkAction,
    INITIAL,
  );
  const [apply, applyAction] = useActionState(applyFairWorkAction, INITIAL);

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Fair Work — live award data</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Pull current classification rates + allowances straight from the Fair
        Work Commission. Rates change with the annual wage review each 1 July —
        re-pull then. Always sanity-check a couple against the Fair Work Pay
        Guide before relying on them.
      </p>

      {!configured ? (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Not configured — set <code>FWC_MAPD_API_KEY</code> in the environment
          to enable the pull.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <form action={previewAction}>
          <ActionButton label="Preview from Fair Work" />
        </form>
        {preview.status === "error" ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {preview.message}
          </p>
        ) : null}
        {preview.status === "preview" ? (
          <p className="text-xs text-muted-foreground">
            {preview.message} · effective {preview.effectiveFrom}
          </p>
        ) : null}
      </div>

      {preview.status === "preview" ? (
        <div className="mt-3 space-y-2">
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {preview.items.map((i) => (
              <li
                key={`${i.kind}-${i.code}`}
                className="flex items-center gap-2"
              >
                <StatusDot status={i.status} />
                <span className="font-medium text-ink">{i.label}</span>
                <span className="text-muted-foreground">
                  {i.kind === "classification" ? "level" : "allowance"} ·{" "}
                  {i.detail}
                </span>
              </li>
            ))}
          </ul>
          <form action={applyAction}>
            <ActionButton label="Apply to classifications + allowances" primary />
          </form>
        </div>
      ) : null}

      {apply.status === "ok" ? (
        <p className="mt-2 text-xs text-[var(--live)]">{apply.message}</p>
      ) : null}
      {apply.status === "error" ? (
        <p className="mt-2 text-xs text-[color:var(--destructive)]">
          {apply.message}
        </p>
      ) : null}
    </section>
  );
}

function StatusDot({ status }: { status: "new" | "changed" | "same" }) {
  const cls =
    status === "new"
      ? "bg-emerald-600"
      : status === "changed"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
      title={status}
    />
  );
}

function ActionButton({
  label,
  primary,
}: {
  label: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        primary
          ? "h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          : "h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
      }
    >
      {pending ? "Working…" : label}
    </button>
  );
}
