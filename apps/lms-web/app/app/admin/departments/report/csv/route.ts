import { requireAdmin } from "~/lib/auth/admin";
import { departmentCompletionReport } from "~/lib/lms/queries/department-report";

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
  const rows = await departmentCompletionReport(ctx.traceyTenantId);

  const lines = [
    csvRow([
      "Department",
      "Employees",
      "Assigned",
      "Completed",
      "Overdue",
      "Completion %",
    ]),
  ];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.departmentName,
        String(r.employees),
        String(r.assigned),
        String(r.completed),
        String(r.overdue),
        String(r.completionPct),
      ]),
    );
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  const today = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=department-completion-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
