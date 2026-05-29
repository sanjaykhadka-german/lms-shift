"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  changeEmployeeRoleAction,
  resetEmployeePasswordAction,
} from "./actions";

interface Props {
  id: number;
  currentRole: string;
}

export function RowActions({ id, currentRole }: Props) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="outline" size="sm" tooltip="Edit this employee's profile">
        <Link href={`/app/admin/employees/${id}/edit`}>Edit</Link>
      </Button>

      <RolePicker id={id} currentRole={currentRole} />

      <form
        action={resetEmployeePasswordAction}
        onSubmit={(e) => {
          if (!confirm("Reset password? A temporary password will be generated.")) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        <SubmitButton label="Reset PW" tooltip="Reset this employee's password" />
      </form>
    </div>
  );
}

function RolePicker({ id, currentRole }: { id: number; currentRole: string }) {
  return (
    <form action={changeEmployeeRoleAction} className="contents">
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        defaultValue={currentRole}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        aria-label="Role"
      >
        <option value="employee">Employee</option>
        <option value="qaqc">QA/QC</option>
        <option value="admin">Admin</option>
      </select>
    </form>
  );
}

function SubmitButton({ label, tooltip }: { label: string; tooltip?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} tooltip={tooltip}>
      {pending ? "…" : label}
    </Button>
  );
}
