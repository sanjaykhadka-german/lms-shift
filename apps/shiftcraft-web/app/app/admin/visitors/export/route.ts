// GET /app/admin/visitors/export?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Streams the visitor log as CSV (manager+ only, tenant-scoped). Columns
// mirror the standalone visitor-app's Excel export. CSV (not xlsx) keeps the
// dependency surface flat — Excel opens it natively.

import { NextResponse } from "next/server";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { forTenant, scVisitorSignins } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";

function csvCell(v: string | null): string {
  const s = (v ?? "").replace(/\r?\n/g, " ");
  // Quote if it contains a comma, quote, or leading/trailing space.
  if (/[",]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmt(d: Date | null): string {
  return d ? d.toISOString() : "";
}

function parseDay(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request): Promise<NextResponse> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return new NextResponse(null, { status: 403 });
  }
  const tenantId = membership.tenant.id;

  const url = new URL(request.url);
  const start = parseDay(url.searchParams.get("start"));
  const endRaw = parseDay(url.searchParams.get("end"));
  // end is inclusive → bump to next midnight for a `< end` comparison.
  const end = endRaw ? new Date(endRaw.getTime() + 86_400_000) : null;

  const conds = [eq(scVisitorSignins.traceyTenantId, tenantId)];
  if (start) conds.push(gte(scVisitorSignins.signedInAt, start));
  if (end) conds.push(lt(scVisitorSignins.signedInAt, end));

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        visitorName: scVisitorSignins.visitorName,
        visitorCompany: scVisitorSignins.visitorCompany,
        visitorMobile: scVisitorSignins.visitorMobile,
        visitingPerson: scVisitorSignins.visitingPerson,
        visitReason: scVisitorSignins.visitReason,
        signedInAt: scVisitorSignins.signedInAt,
        signedOutAt: scVisitorSignins.signedOutAt,
      })
      .from(scVisitorSignins)
      .where(and(...conds))
      .orderBy(asc(scVisitorSignins.signedInAt)),
  );

  const header = [
    "Full Name",
    "Company",
    "Mobile",
    "Visiting Person",
    "Visit Reason",
    "Signed In",
    "Signed Out",
    "Status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.visitorName),
        csvCell(r.visitorCompany),
        csvCell(r.visitorMobile),
        csvCell(r.visitingPerson),
        csvCell(r.visitReason),
        csvCell(fmt(r.signedInAt)),
        csvCell(fmt(r.signedOutAt)),
        csvCell(r.signedOutAt ? "Signed Out" : "Signed In"),
      ].join(","),
    );
  }
  const csv = "﻿" + lines.join("\r\n");
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="visitor_records_${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
