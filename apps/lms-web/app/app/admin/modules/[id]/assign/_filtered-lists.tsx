"use client";

import { useState } from "react";
import { formatDate } from "~/lib/format/datetime";
import { Button } from "~/components/ui/button";

const NO_DEPT = "__none__";

function DeptFilter({
  value,
  onChange,
  departments,
}: {
  value: string;
  onChange: (v: string) => void;
  departments: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-48 rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
      aria-label="Filter by department"
    >
      <option value="">All departments</option>
      <option value={NO_DEPT}>— No department —</option>
      {departments.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </select>
  );
}

function matches(rowDept: string | null, selected: string): boolean {
  if (selected === "") return true;
  if (selected === NO_DEPT) return rowDept === null;
  return rowDept === selected;
}

export function StaffPicker({
  moduleId,
  employees,
  alreadyAssignedIds,
  departments,
  bulkAssignAction,
}: {
  moduleId: number;
  employees: Array<{
    id: number;
    name: string;
    email: string;
    isActiveFlag: boolean | null;
    departmentName: string | null;
  }>;
  alreadyAssignedIds: number[];
  departments: string[];
  bulkAssignAction: (formData: FormData) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<string>("");
  const alreadySet = new Set(alreadyAssignedIds);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <DeptFilter value={selected} onChange={setSelected} departments={departments} />
      </div>

      <form action={bulkAssignAction} className="space-y-3">
        <input type="hidden" name="module_id" value={moduleId} />
        <div className="max-h-96 overflow-y-auto rounded-md border border-[color:var(--border)] p-3">
          {employees.length === 0 ? (
            <p className="text-sm text-[color:var(--muted-foreground)]">
              No staff in this workspace yet.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {employees.map((e) => {
                const already = alreadySet.has(e.id);
                const visible = matches(e.departmentName, selected);
                return (
                  <li
                    key={e.id}
                    className={`flex items-center gap-3 py-2 text-sm ${visible ? "" : "hidden"}`}
                  >
                    <input
                      type="checkbox"
                      name="user_ids"
                      value={e.id}
                      defaultChecked={already}
                      disabled={already}
                      className="h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {e.name}
                        {!e.isActiveFlag && (
                          <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">
                            (disabled)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        {e.email}
                        {e.departmentName && <> · {e.departmentName}</>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Button type="submit">Assign selected</Button>
      </form>
    </div>
  );
}

export function AssignedList({
  moduleId,
  rows,
  departments,
  unassignAction,
  tenantTimezone,
}: {
  moduleId: number;
  rows: Array<{
    id: number;
    userId: number;
    userName: string;
    userEmail: string;
    assignedAt: Date | string | null;
    dueAt: Date | string | null;
    completedAt: Date | string | null;
    departmentName: string | null;
  }>;
  departments: string[];
  unassignAction: (formData: FormData) => void | Promise<void>;
  tenantTimezone: string;
}) {
  const [selected, setSelected] = useState<string>("");

  if (rows.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
        No assignments yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex justify-end px-6 pt-4">
        <DeptFilter value={selected} onChange={setSelected} departments={departments} />
      </div>
      <div className="divide-y divide-[color:var(--border)]">
        {rows.map((r) => {
          const visible = matches(r.departmentName, selected);
          return (
            <div
              key={r.id}
              className={`flex items-center justify-between gap-3 px-6 py-3 ${visible ? "" : "hidden"}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.userName}</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  {r.userEmail}
                  {r.departmentName && <> · {r.departmentName}</>}
                  {r.dueAt && <> · Due {formatDate(r.dueAt, tenantTimezone)}</>}
                  {r.completedAt && (
                    <> · Completed {formatDate(r.completedAt, tenantTimezone)}</>
                  )}
                </div>
              </div>
              <form action={unassignAction}>
                <input type="hidden" name="module_id" value={moduleId} />
                <input type="hidden" name="id" value={r.id} />
                <Button type="submit" variant="outline" size="sm">
                  Unassign
                </Button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
