import { requireAdmin } from "~/lib/auth/admin";
import { listAdminAssignments } from "~/lib/lms/queries/assignments";
import { formatDate } from "~/lib/format/datetime";

function csvCell(s: string | null | undefined): string {
  const v = s ?? "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function csvRow(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

export async function GET() {
  const ctx = await requireAdmin();
  const rows = await listAdminAssignments(ctx);
  const now = Date.now();
  const fmt = (d: Date | null) =>
    d
      ? formatDate(d, ctx.tenantTimezone, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
      : "";

  const status = (r: (typeof rows)[number]): string => {
    if (r.completedAt) return "Completed";
    if (r.dueAt && r.dueAt.getTime() < now) return "Overdue";
    return "Outstanding";
  };

  const lines = [
    csvRow([
      "Employee",
      "Email",
      "Department",
      "Module",
      "Assigned",
      "Due",
      "Completed",
      "Status",
    ]),
  ];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.userName,
        r.userEmail,
        r.departmentName,
        r.moduleTitle,
        fmt(r.assignedAt),
        fmt(r.dueAt),
        fmt(r.completedAt),
        status(r),
      ]),
    );
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  const today = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=assignments-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
