import { asc, eq } from "drizzle-orm";
import {
  lmsDepartments,
  lmsEmployers,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";

const HEADERS = [
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Department",
  "Employer",
  "Position",
  "Job Title",
  "Role",
  "Status",
  "Start Date",
  "Termination Date",
];

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
  const rows = await ctx.db.run((tx) =>
    tx
      .select({
        firstName: lmsUsers.firstName,
        lastName: lmsUsers.lastName,
        email: lmsUsers.email,
        phone: lmsUsers.phone,
        departmentName: lmsDepartments.name,
        employerName: lmsEmployers.name,
        positionName: lmsPositions.name,
        jobTitle: lmsUsers.jobTitle,
        role: lmsUsers.role,
        isActiveFlag: lmsUsers.isActiveFlag,
        startDate: lmsUsers.startDate,
        terminationDate: lmsUsers.terminationDate,
      })
      .from(lmsUsers)
      .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
      .leftJoin(lmsEmployers, eq(lmsEmployers.id, lmsUsers.employerId))
      .leftJoin(lmsPositions, eq(lmsPositions.id, lmsUsers.positionId))
      .where(eq(lmsUsers.traceyTenantId, ctx.traceyTenantId))
      .orderBy(asc(lmsUsers.name)),
  );

  const lines = [csvRow(HEADERS)];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.firstName,
        r.lastName,
        r.email,
        r.phone,
        r.departmentName,
        r.employerName,
        r.positionName,
        r.jobTitle,
        r.role,
        r.isActiveFlag ? "Active" : "Disabled",
        r.startDate,
        r.terminationDate,
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
      "Content-Disposition": `attachment; filename=staff-register-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
