"use client";

import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatDate } from "~/lib/format/datetime";
import { isEffectivelyActive } from "~/lib/lms/employee-status";
import { DeleteRowForm } from "../_components/DeleteRowForm";

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

export function BulkAssign({
  employees,
  modules,
  departments,
  bulkAssignAction,
}: {
  employees: Array<{
    id: number;
    name: string;
    email: string;
    isActiveFlag: boolean | null;
    terminationDate: string | null;
    departmentName: string | null;
  }>;
  modules: Array<{ id: number; title: string }>;
  departments: string[];
  bulkAssignAction: (formData: FormData) => Promise<void>;
}) {
  const [selectedDept, setSelectedDept] = useState<string>("");

  if (modules.length === 0) {
    return (
      <p className="text-sm text-[color:var(--muted-foreground)]">
        Publish a module first to enable bulk-assign.
      </p>
    );
  }

  return (
    <form action={bulkAssignAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="bulk-module-id" className="block text-sm font-medium">
            Module
          </label>
          <select
            id="bulk-module-id"
            name="module_id"
            required
            defaultValue=""
            className="h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="" disabled>
              — Select module —
            </option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="bulk-dept-filter" className="block text-sm font-medium">
            Filter staff by department
          </label>
          <select
            id="bulk-dept-filter"
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
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
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-md border border-[color:var(--border)] p-3">
        {employees.length === 0 ? (
          <p className="text-sm text-[color:var(--muted-foreground)]">
            No staff in this workspace yet.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {employees.map((e) => {
              const visible = matches(e.departmentName, selectedDept);
              const active = isEffectivelyActive(e);
              return (
                <li
                  key={e.id}
                  className={`flex items-center gap-3 py-2 text-sm ${visible ? "" : "hidden"}`}
                >
                  <input
                    type="checkbox"
                    name="user_ids"
                    value={e.id}
                    className="h-4 w-4"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {e.name}
                      {!active && (
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
  );
}

export function AssignmentsTable({
  rows,
  departments,
  deleteAction,
  tenantTimezone,
}: {
  rows: Array<{
    id: number;
    moduleId: number;
    moduleTitle: string;
    userId: number;
    userName: string;
    userEmail: string;
    assignedAt: Date | string | null;
    dueAt: Date | string | null;
    completedAt: Date | string | null;
    departmentName: string | null;
  }>;
  departments: string[];
  deleteAction: (formData: FormData) => Promise<void>;
  tenantTimezone: string;
}) {
  const [selectedDept, setSelectedDept] = useState<string>("");
  const now = Date.now();
  const soonMs = 14 * 24 * 60 * 60 * 1000;

  return (
    <div>
      <div className="flex justify-end px-6 pt-4">
        <DeptFilter
          value={selectedDept}
          onChange={setSelectedDept}
          departments={departments}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
            <tr>
              <th className="px-6 py-2">Module</th>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Assigned</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-6 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-6 text-center text-[color:var(--muted-foreground)]"
                >
                  No assignments yet — use the bulk-assign card above to assign training.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const visible = matches(r.departmentName, selectedDept);
                const dueTime = r.dueAt
                  ? typeof r.dueAt === "string"
                    ? new Date(r.dueAt).getTime()
                    : r.dueAt.getTime()
                  : null;
                const status = r.completedAt
                  ? "completed"
                  : dueTime !== null && dueTime < now
                    ? "overdue"
                    : dueTime !== null && dueTime < now + soonMs
                      ? "due_soon"
                      : "open";
                return (
                  <tr key={r.id} className={visible ? "" : "hidden"}>
                    <td className="px-6 py-3 align-middle">
                      <a
                        href={`/app/admin/modules/${r.moduleId}`}
                        className="font-medium hover:underline"
                      >
                        {r.moduleTitle}
                      </a>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div>{r.userName}</div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        {r.userEmail}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {r.departmentName ?? "—"}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {r.assignedAt ? formatDate(r.assignedAt, tenantTimezone) : "—"}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {r.dueAt ? formatDate(r.dueAt, tenantTimezone) : "—"}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-6 py-3 align-middle text-right">
                      <DeleteRowForm
                        action={deleteAction}
                        id={r.id}
                        label="Unassign"
                        tooltip="Remove this training assignment from the employee"
                        confirmMessage={`Unassign ${r.userName} from '${r.moduleTitle}'?`}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge variant="success">Completed</Badge>;
  if (status === "overdue") return <Badge variant="destructive">Overdue</Badge>;
  if (status === "due_soon") return <Badge variant="warning">Due soon</Badge>;
  return <Badge variant="outline">Open</Badge>;
}
