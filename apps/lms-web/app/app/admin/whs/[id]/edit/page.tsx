import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { lmsUsers, lmsWhsRecords } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { ensureSystemKinds, listWhsKinds } from "~/lib/lms/whs-kinds";
import { WhsForm } from "../../_form";
import { updateWhsRecordAction } from "../../actions";

export const metadata = { title: "Edit WHS record" };

export default async function EditWhsRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const recordId = parseInt(id, 10);
  if (!Number.isFinite(recordId)) notFound();
  const sp = await searchParams;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  await ensureSystemKinds({ db: ctx.db, traceyTenantId: tid });

  const [[record], staff, kindRows] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsWhsRecords)
        .where(and(eq(lmsWhsRecords.id, recordId), tenantWhere(lmsWhsRecords, tid)))
        .limit(1),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsUsers.id, name: lmsUsers.name })
        .from(lmsUsers)
        .where(eq(lmsUsers.traceyTenantId, tid))
        .orderBy(asc(lmsUsers.name)),
    ),
    listWhsKinds({ db: ctx.db, traceyTenantId: tid }),
  ]);
  if (!record) notFound();
  const kinds = kindRows.map((k) => ({ slug: k.slug, label: k.label, category: k.category }));

  const banner =
    sp.error === "date"
      ? "Date format wrong. Use YYYY-MM-DD."
      : sp.error === "invalid"
        ? "Some required fields are missing or invalid."
        : sp.error === "upload"
          ? "Couldn't save the attached document. Check file type and size (max 10 MB)."
          : undefined;

  return (
    <div className="space-y-4">
      <BackLink href="/app/admin/whs">Back to register</BackLink>
      <WhsForm
        action={updateWhsRecordAction}
        staff={staff}
        kinds={kinds}
        errorBanner={banner}
        record={{
          id: record.id,
          kind: record.kind,
          title: record.title,
          userId: record.userId,
          issuedOn: record.issuedOn,
          expiresOn: record.expiresOn,
          notes: record.notes ?? "",
          incidentDate: record.incidentDate,
          severity: record.severity,
          reportedById: record.reportedById,
          documentFilename: record.documentFilename,
        }}
      />
    </div>
  );
}
