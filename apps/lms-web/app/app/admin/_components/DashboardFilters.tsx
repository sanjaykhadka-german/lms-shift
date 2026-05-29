"use client";

import { Button } from "~/components/ui/button";

export type DashboardFilterOption = { id: number; label: string };

export function DashboardFilters({
  from,
  to,
  deptId,
  moduleId,
  departments,
  modules,
}: {
  from: string; // yyyy-mm-dd
  to: string;   // yyyy-mm-dd
  deptId: string; // "all" or numeric string
  moduleId: string;
  departments: DashboardFilterOption[];
  modules: DashboardFilterOption[];
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-3"
    >
      <FilterField label="From">
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm"
        />
      </FilterField>
      <FilterField label="To">
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm"
        />
      </FilterField>
      <FilterField label="Department">
        <select
          name="dept"
          defaultValue={deptId}
          className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm"
        >
          <option value="all">All</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label="Module">
        <select
          name="module"
          defaultValue={moduleId}
          className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm"
        >
          <option value="all">All</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </FilterField>
      <div className="ml-auto flex gap-2">
        <Button type="submit" variant="default">
          Apply
        </Button>
        <Button type="submit" name="reset" value="1" variant="outline">
          Reset
        </Button>
      </div>
    </form>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </span>
      {children}
    </label>
  );
}
