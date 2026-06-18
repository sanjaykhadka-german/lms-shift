"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { assignEmployeeLevelAction, type FormState } from "./actions";

const INITIAL: FormState = { status: "idle" };

interface FloorResult {
  ok: boolean;
  minimum: number;
  shortfall: number;
  rateKnown: boolean;
}

interface EmployeeRow {
  id: string;
  fullName: string;
  employmentType: string;
  hourlyRate: number | null;
  awardLevelCode: string | null;
  floor: FloorResult | null;
}

export function AssignmentsCard({
  employees,
  levelOptions,
  floorBlock,
}: {
  employees: EmployeeRow[];
  levelOptions: Array<{ levelCode: string; label: string }>;
  floorBlock: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Team classifications</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Assign each team member a level. The badge flags anyone paid below their
        classification minimum {floorBlock ? "(blocking)" : "(warning only)"}.
      </p>
      <div className="mt-3 space-y-1.5">
        {employees.map((e) => (
          <RowForm
            key={e.id}
            employee={e}
            levelOptions={levelOptions}
            floorBlock={floorBlock}
          />
        ))}
        {employees.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active team members.</p>
        ) : null}
      </div>
    </section>
  );
}

function RowForm({
  employee,
  levelOptions,
  floorBlock,
}: {
  employee: EmployeeRow;
  levelOptions: Array<{ levelCode: string; label: string }>;
  floorBlock: boolean;
}) {
  const [, action] = useActionState(assignEmployeeLevelAction, INITIAL);
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs"
    >
      <input type="hidden" name="employeeId" value={employee.id} />
      <span className="min-w-[140px] flex-1 font-medium text-ink">
        {employee.fullName}
      </span>
      <span className="text-muted-foreground">{employee.employmentType}</span>
      <span className="text-muted-foreground">
        {employee.hourlyRate != null
          ? `$${employee.hourlyRate.toFixed(2)}/h`
          : "no rate"}
      </span>
      <select
        name="levelCode"
        defaultValue={employee.awardLevelCode ?? ""}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">— No level —</option>
        {levelOptions.map((l) => (
          <option key={l.levelCode} value={l.levelCode}>
            {l.levelCode} · {l.label}
          </option>
        ))}
      </select>
      <SaveButton />
      <FloorBadge floor={employee.floor} block={floorBlock} />
    </form>
  );
}

function FloorBadge({
  floor,
  block,
}: {
  floor: FloorResult | null;
  block: boolean;
}) {
  if (!floor) {
    return <Badge tone="muted">No classification</Badge>;
  }
  if (!floor.rateKnown) {
    return <Badge tone="muted">Rate not set</Badge>;
  }
  if (floor.ok) {
    return <Badge tone="ok">At/above min (${floor.minimum.toFixed(2)})</Badge>;
  }
  return (
    <Badge tone={block ? "block" : "warn"}>
      {block ? "BLOCK" : "Under min"}: needs ${floor.minimum.toFixed(2)} (−$
      {floor.shortfall.toFixed(2)})
    </Badge>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "block" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-600 text-white"
      : tone === "warn"
        ? "bg-amber-500 text-white"
        : tone === "block"
          ? "bg-rose-600 text-white"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
    >
      {pending ? "…" : "Save"}
    </button>
  );
}
