import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { currentMembership } from "~/lib/auth/current";
import { listEarnedCertificates } from "~/lib/lms/certificates";
import { formatDate } from "~/lib/format/datetime";
import { Button } from "~/components/ui/button";
import { TranscriptDocument } from "~/components/transcript-document";
import { PrintButton } from "~/app/app/my/certificates/_print-button";

export const metadata = { title: "Employee transcript" };

export default async function AdminEmployeeTranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const employeeId = parseInt(id, 10);
  if (!Number.isFinite(employeeId)) notFound();

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [employee] = await ctx.db.run((tx) =>
    tx
      .select({ name: lmsUsers.name, email: lmsUsers.email })
      .from(lmsUsers)
      .where(and(eq(lmsUsers.id, employeeId), eq(lmsUsers.traceyTenantId, tid)))
      .limit(1),
  );
  if (!employee) notFound();

  const certs = await listEarnedCertificates(employeeId, tid);
  const membership = await currentMembership();

  const fmt = (d: Date) =>
    formatDate(d, ctx.tenantTimezone, { year: "numeric", month: "short", day: "numeric" }) || "—";
  const generated =
    formatDate(new Date(), ctx.tenantTimezone, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }) || "";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/admin/employees/${employeeId}`}>← Employee</Link>
        </Button>
        <PrintButton />
      </div>

      <TranscriptDocument
        workspace={membership?.tenant.name ?? ""}
        recipientName={employee.name?.trim() || employee.email}
        recipientEmail={employee.email}
        generatedDate={generated}
        rows={certs.map((c) => ({
          moduleTitle: c.moduleTitle,
          dateStr: fmt(c.passedAt),
          score: c.score,
        }))}
      />
    </div>
  );
}
