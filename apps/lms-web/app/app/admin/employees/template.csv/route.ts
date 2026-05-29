import { requireAdmin } from "~/lib/auth/admin";

// CSV template download — port of /admin/employees/template.csv (app.py:3010).
// UTF-8 BOM so Excel auto-detects encoding.

const HEADERS = [
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Department",
  "Role",
  "Employer",
  "Machines",
  "Start Date",
  "Termination Date",
  "Job Title",
  "Position",
];

const ROWS = [
  [
    "Jane",
    "Doe",
    "jane.doe@example.com",
    "0400 000 000",
    "Production",
    "employee",
    "German Butchery",
    "Mincer; Sausage filler",
    "2024-03-15",
    "",
    "Senior Line Leader",
    "Production Manager",
  ],
  [
    "John",
    "Smith",
    "john.smith@example.com",
    "0411 111 111",
    "Packing",
    "employee",
    "Acme Staffing",
    "",
    "15/03/2024",
    "",
    "",
    "Packer",
  ],
];

function csvCell(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

export async function GET() {
  await requireAdmin();
  const lines = [csvRow(HEADERS), ...ROWS.map(csvRow)];
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=users_template.csv",
      "Cache-Control": "no-store",
    },
  });
}
