import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLearner } from "~/lib/lms/learner";
import { currentMembership } from "~/lib/auth/current";
import { getEarnedCertificate } from "~/lib/lms/certificates";
import { Button } from "~/components/ui/button";
import { CertificateCard } from "~/components/certificate-card";
import { signCertificate } from "~/lib/lms/certificate-token";
import { siteConfig } from "~/lib/site-config";
import { PrintButton } from "../_print-button";

export const metadata = { title: "Certificate" };

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = await params;
  const mid = parseInt(moduleId, 10);
  if (!Number.isFinite(mid)) notFound();

  const { lmsUser, traceyTenantId, tenantTimezone } = await requireLearner();
  const cert = await getEarnedCertificate(mid, lmsUser.id, traceyTenantId);
  if (!cert) notFound();

  const membership = await currentMembership();
  const workspace = membership?.tenant.name ?? "";
  const learnerName = lmsUser.name?.trim() || lmsUser.email;
  const dateStr = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeZone: tenantTimezone,
  }).format(cert.passedAt);

  const verifyUrl = `${siteConfig.url}/verify/${signCertificate({
    tenantId: traceyTenantId,
    userId: lmsUser.id,
    moduleId: cert.moduleId,
  })}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Toolbar — hidden when printing */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/my/certificates">← Certificates</Link>
        </Button>
        <PrintButton />
      </div>

      <CertificateCard
        workspace={workspace}
        recipientName={learnerName}
        moduleTitle={cert.moduleTitle}
        score={cert.score}
        dateStr={dateStr}
        verifyUrl={verifyUrl}
      />
    </div>
  );
}
