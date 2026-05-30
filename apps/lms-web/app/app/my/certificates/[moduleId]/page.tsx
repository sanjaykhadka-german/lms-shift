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
import { resendCertificateEmailAction } from "./actions";

export const metadata = { title: "Certificate" };

export default async function CertificatePage({
  params,
  searchParams,
}: {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{ resent?: string }>;
}) {
  const { moduleId } = await params;
  const { resent } = await searchParams;
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
        <div className="flex items-center gap-2">
          <form action={resendCertificateEmailAction}>
            <input type="hidden" name="moduleId" value={mid} />
            <Button type="submit" variant="outline">
              Email it to me
            </Button>
          </form>
          <PrintButton />
        </div>
      </div>

      {resent && (
        <p className="mb-6 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 print:hidden">
          Certificate emailed to {lmsUser.email}.
        </p>
      )}

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
