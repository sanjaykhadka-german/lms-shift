import { type NextRequest } from "next/server";
import { requireAdmin } from "~/lib/auth/admin";
import { listAdminWhsRecords } from "~/lib/lms/queries/whs";

function csvCell(s: string | null | undefined): string {
  const v = s ?? "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function csvRow(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

// Expiry status from an ISO date string (YYYY-MM-DD). Lexical comparison is
// valid for ISO dates. Blank for records with no expiry (incidents, etc.).
function expiryStatus(expiresOn: string | null): string {
  if (!expiresOn) return "";
  const today = new Date().toISOString().slice(0, 10);
  if (expiresOn < today) return "Expired";
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return expiresOn <= soon ? "Expiring soon" : "Valid";
}

// CSV of the WHS register, honoring the page's ?kind filter.
export async function GET(request: NextRequest) {
  const ctx = await requireAdmin();
  const kind = request.nextUrl.searchParams.get("kind") ?? undefined;
  const records = await listAdminWhsRecords(ctx, { kindFilter: kind });

  const HEADERS = [
    "Kind",
    "Title",
    "Employee",
    "Issued",
    "Expires",
    "Status",
    "Severity",
    "Incident date",
    "Document",
  ];
  const lines = [csvRow(HEADERS)];
  for (const r of records) {
    lines.push(
      csvRow([
        r.kind,
        r.title,
        r.userName,
        r.issuedOn,
        r.expiresOn,
        expiryStatus(r.expiresOn),
        r.severity,
        r.incidentDate,
        r.documentFilename,
      ]),
    );
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  const today = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=whs-register-${today}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
