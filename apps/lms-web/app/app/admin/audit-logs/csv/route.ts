import { requireAdmin } from "~/lib/auth/admin";
import { loadAuditLog } from "~/lib/lms/queries/audit-log";
import { formatDateTime } from "~/lib/format/datetime";

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
  const rows = await loadAuditLog(ctx);

  const lines = [
    csvRow(["When", "Source", "Actor", "Action", "Target", "Details"]),
  ];
  for (const r of rows) {
    lines.push(
      csvRow([
        formatDateTime(r.createdAt, ctx.tenantTimezone),
        r.source,
        r.actorEmail,
        r.action,
        r.entity,
        r.summary,
      ]),
    );
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  const today = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=audit-log-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
