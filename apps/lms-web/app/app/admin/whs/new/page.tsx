import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { PageHeader } from "~/components/page-header";
import { asc, eq } from "drizzle-orm";
import { lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { ensureSystemKinds, listWhsKinds } from "~/lib/lms/whs-kinds";
import { WhsForm } from "../_form";
import { createWhsRecordAction } from "../actions";

export const metadata = { title: "New WHS record" };

export default async function NewWhsRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  await ensureSystemKinds({ db: ctx.db, traceyTenantId: ctx.traceyTenantId });

  const [staff, kindRows] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsUsers.id, name: lmsUsers.name })
        .from(lmsUsers)
        .where(eq(lmsUsers.traceyTenantId, ctx.traceyTenantId))
        .orderBy(asc(lmsUsers.name)),
    ),
    listWhsKinds({ db: ctx.db, traceyTenantId: ctx.traceyTenantId }),
  ]);
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
    <div className="space-y-6">
      <BackLink href="/app/admin/whs">Back to register</BackLink>
      <PageHeader
        title="New WHS record"
        description="Capture a new health & safety incident, training record, or audit note. Required fields are marked below."
      />
      <WhsForm action={createWhsRecordAction} staff={staff} kinds={kinds} errorBanner={banner} />
    </div>
  );
}
