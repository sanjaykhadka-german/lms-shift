// GET /app/people/documents/<id>/download
//
// Streams the bytea payload of a sc_documents row. Tenant-scoped via
// forTenant so a foreign id quietly returns 404 (no cross-tenant probe
// surface). Access rules:
//   - 'library' scope : any member of the tenant.
//   - 'team' scope    : admin/owner OR the employee whose row this is.
//
// Cache-Control is private, no-cache because team documents can be
// rotated (re-uploaded with the same id is impossible; deleted-then-
// re-uploaded gets a fresh id, but documents that the admin replaces
// should not be cached by intermediaries either way).

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { forTenant, scDocuments, scEmployees } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership) {
    return new NextResponse(null, { status: 401 });
  }
  const tenantId = membership.tenant.id;
  const canManage = isAtLeastManager(membership.role);

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        data: scDocuments.data,
        mimeType: scDocuments.mimeType,
        title: scDocuments.title,
        scope: scDocuments.scope,
        employeeId: scDocuments.employeeId,
        ownerUserId: scEmployees.appUserId,
      })
      .from(scDocuments)
      .leftJoin(
        scEmployees,
        eq(scEmployees.id, scDocuments.employeeId),
      )
      .where(
        and(
          eq(scDocuments.id, id),
          eq(scDocuments.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );

  if (!row || !row.data) {
    return new NextResponse(null, { status: 404 });
  }

  if (row.scope === "team" && !canManage && row.ownerUserId !== me.id) {
    return new NextResponse(null, { status: 403 });
  }

  // RFC 5987 percent-encoded filename so unicode titles survive the header.
  const safeName = encodeURIComponent(row.title);

  // PDFs and images preview in the browser ('inline') — managers verify
  // the right file landed without a download round-trip. Office docs
  // (DOCX/DOC) and plain text fall back to 'attachment' because browsers
  // don't render them and would just dump bytes into a tab otherwise.
  const previewable =
    row.mimeType === "application/pdf" || row.mimeType.startsWith("image/");
  const disposition = previewable ? "inline" : "attachment";

  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${safeName}`,
      "Cache-Control": "private, no-cache",
    },
  });
}
