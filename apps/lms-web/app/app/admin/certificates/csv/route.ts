import { requireAdmin } from "~/lib/auth/admin";
import { listAllCertificates } from "~/lib/lms/certificates";
import { formatDate } from "~/lib/format/datetime";

const HEADERS = ["Employee", "Email", "Module", "Passed", "Score"];

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
  const rows = await listAllCertificates(ctx.traceyTenantId);

  const lines = [csvRow(HEADERS)];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.employeeName,
        r.employeeEmail,
        r.moduleTitle,
        formatDate(r.passedAt, ctx.tenantTimezone, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
        String(r.score),
      ]),
    );
  }
  // BOM so Excel autodetects UTF-8.
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  const today = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=certificates-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
