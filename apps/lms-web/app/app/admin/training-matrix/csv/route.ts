import { type NextRequest } from "next/server";
import { requireAdmin } from "~/lib/auth/admin";
import { buildTrainingMatrix } from "~/lib/lms/training-matrix";
import { formatDate } from "~/lib/format/datetime";

function csvCell(s: string | null | undefined): string {
  const v = s ?? "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function csvRow(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

// CSV of the training matrix, honoring the same dept/module/search filters as
// the page. One row per employee; one column per (filtered) module with the
// latest status: "Passed <date>" / "Failed" / "Assigned" / "Not assigned".
export async function GET(request: NextRequest) {
  const ctx = await requireAdmin();
  const sp = request.nextUrl.searchParams;
  const dept = sp.get("dept");
  const moduleParam = sp.get("module");
  const q = sp.get("q") ?? "";

  const { modules, users, assignmentSet, latest } = await buildTrainingMatrix(
    ctx.traceyTenantId,
    {
      dept: dept && dept !== "all" ? Number(dept) : null,
      module: moduleParam && moduleParam !== "all" ? Number(moduleParam) : null,
      q,
      auditMode: ctx.tenantAuditMode && ctx.tenantAuditSettings.hideFailedAttempts,
    },
  );

  const fmt = (d: Date) =>
    formatDate(d, ctx.tenantTimezone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }) || "";

  const lines = [
    csvRow(["Employee", "Email", "Department", ...modules.map((m) => m.title)]),
  ];
  for (const u of users) {
    const userLatest = latest.get(u.id);
    const cells: Array<string | null | undefined> = [
      u.name,
      u.email,
      u.departmentName ?? "",
    ];
    for (const m of modules) {
      const entry = userLatest?.get(m.id);
      const assigned = assignmentSet.has(`${u.id}|${m.id}`);
      let v: string;
      if (entry?.passed === true) {
        v = entry.passedAt ? `Passed ${fmt(entry.passedAt)}` : "Passed";
      } else if (entry?.passed === false) {
        v = "Failed";
      } else if (assigned) {
        v = "Assigned";
      } else {
        v = "Not assigned";
      }
      cells.push(v);
    }
    lines.push(csvRow(cells));
  }

  const body = "﻿" + lines.join("\r\n") + "\r\n";
  const today = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=training-matrix-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
