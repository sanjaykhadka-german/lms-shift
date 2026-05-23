"use client";

import { useState } from "react";
import {
  EmployeeDetailModal,
  type EmployeeDetail,
} from "./EmployeeDetailModal";

// Server-rendered table cells stay server-rendered; only this tiny
// wrapper owns the open/close state for the detail modal so the rest of
// the page can stay free of client boundaries.

export function EmployeeNameButton({
  employee,
  canManage,
  display,
}: {
  employee: EmployeeDetail;
  canManage: boolean;
  display: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-sm"
        aria-label={`Open profile for ${employee.fullName}`}
      >
        {display}
      </button>
      <EmployeeDetailModal
        open={open}
        onClose={() => setOpen(false)}
        employee={employee}
        canManage={canManage}
      />
    </>
  );
}
