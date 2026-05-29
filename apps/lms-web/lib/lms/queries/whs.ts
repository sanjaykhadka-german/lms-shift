import "server-only";
import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { lmsUsers, lmsWhsRecords } from "@tracey/db";
import type { LearnerContext } from "~/lib/lms/learner";
import { tenantWhere } from "~/lib/lms/tenant-scope";

export interface AdminWhsRow {
  id: number;
  kind: string;
  title: string;
  issuedOn: string | null;
  expiresOn: string | null;
  severity: string | null;
  incidentDate: string | null;
  documentFilename: string | null;
  userName: string | null;
}

/** WHS register for /app/admin/whs. In Audit Mode, drops records whose
 *  expiry has already passed (records without an expiry date — incidents,
 *  open licences — stay visible). The expiring-30d widget recomputes
 *  naturally because it walks this same row set. */
export async function listAdminWhsRecords(
  ctx: LearnerContext,
  opts: { kindFilter?: string } = {},
): Promise<AdminWhsRow[]> {
  const tid = ctx.traceyTenantId;
  const today = sql`current_date`;
  const hideExpired =
    ctx.tenantAuditMode && ctx.tenantAuditSettings.hideExpiredWhs;
  const auditModeFilter = hideExpired
    ? or(isNull(lmsWhsRecords.expiresOn), gte(lmsWhsRecords.expiresOn, today))
    : undefined;
  const kindFilter = opts.kindFilter
    ? eq(lmsWhsRecords.kind, opts.kindFilter)
    : undefined;

  const conditions = [tenantWhere(lmsWhsRecords, tid), kindFilter, auditModeFilter].filter(
    (c): c is NonNullable<typeof c> => c !== undefined,
  );

  return ctx.db.run((tx) =>
    tx
      .select({
        id: lmsWhsRecords.id,
        kind: lmsWhsRecords.kind,
        title: lmsWhsRecords.title,
        issuedOn: lmsWhsRecords.issuedOn,
        expiresOn: lmsWhsRecords.expiresOn,
        severity: lmsWhsRecords.severity,
        incidentDate: lmsWhsRecords.incidentDate,
        documentFilename: lmsWhsRecords.documentFilename,
        userName: lmsUsers.name,
      })
      .from(lmsWhsRecords)
      .leftJoin(lmsUsers, eq(lmsUsers.id, lmsWhsRecords.userId))
      .where(and(...conditions))
      .orderBy(desc(lmsWhsRecords.expiresOn), asc(lmsWhsRecords.title)),
  );
}
