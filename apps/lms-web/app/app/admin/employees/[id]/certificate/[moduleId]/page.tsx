import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { currentMembership } from "~/lib/auth/current";
import { getEarnedCertificate } from "~/lib/lms/certificates";
import { Button } from "~/components/ui/button";
import { CertificateCard } from "~/components/certificate-card";
import { signCertificate } from "~/lib/lms/certificate-token";
import { siteConfig } from "~/lib/site-config";
import { PrintButton } from "~/app/app/my/certificates/_print-button";

export const metadata = { title: "Employee certificate" };

export default async function AdminEmployeeCertificatePage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;
  const employeeId = parseInt(id, 10);
  const mid = parseInt(moduleId, 10);
  if (!Number.isFinite(employeeId) || !Number.isFinite(mid)) notFound();

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  // Load the employee (tenant-scoped via forTenant + explicit filter).
  const [employee] = await ctx.db.run((tx) =>
    tx
      .select({ name: lmsUsers.name, email: lmsUsers.email })
      .from(lmsUsers)
      .where(and(eq(lmsUsers.id, employeeId), eq(lmsUsers.traceyTenantId, tid)))
      .limit(1),
  );
  if (!employee) notFound();

  const cert = await getEarnedCertificate(mid, employeeId, tid);
  if (!cert) notFound();

  const membership = await currentMembership();
  const workspace = membership?.tenant.name ?? "";
  const recipientName = employee.name?.trim() || employee.email;
  const dateStr = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeZone: ctx.tenantTimezone,
  }).format(cert.passedAt);

  const verifyUrl = `${siteConfig.url}/verify/${signCertificate({
    tenantId: tid,
    userId: employeeId,
    moduleId: mid,
  })}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/admin/employees/${employeeId}`}>← Employee</Link>
        </Button>
        <PrintButton />
      </div>

      <CertificateCard
        workspace={workspace}
        recipientName={recipientName}
        moduleTitle={cert.moduleTitle}
        score={cert.score}
        dateStr={dateStr}
      />
    </div>
  );
}
