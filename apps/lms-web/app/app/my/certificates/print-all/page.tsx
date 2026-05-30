import Link from "next/link";
import { requireLearner } from "~/lib/lms/learner";
import { currentMembership } from "~/lib/auth/current";
import { listEarnedCertificates } from "~/lib/lms/certificates";
import { signCertificate } from "~/lib/lms/certificate-token";
import { formatDate } from "~/lib/format/datetime";
import { siteConfig } from "~/lib/site-config";
import { Button } from "~/components/ui/button";
import { CertificateCard } from "~/components/certificate-card";
import { PrintButton } from "../_print-button";

export const metadata = { title: "All certificates" };

export default async function PrintAllCertificatesPage() {
  const { lmsUser, traceyTenantId, tenantTimezone } = await requireLearner();
  const certs = await listEarnedCertificates(lmsUser.id, traceyTenantId);
  const membership = await currentMembership();
  const workspace = membership?.tenant.name ?? "";
  const recipientName = lmsUser.name?.trim() || lmsUser.email;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/my/certificates">← Certificates</Link>
        </Button>
        <PrintButton />
      </div>

      {certs.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-[color:var(--muted-foreground)] print:hidden">
          You haven&apos;t earned any certificates yet.
        </p>
      ) : (
        certs.map((c, i) => (
          <div
            key={c.moduleId}
            className={i < certs.length - 1 ? "mb-8 break-after-page" : ""}
          >
            <CertificateCard
              workspace={workspace}
              recipientName={recipientName}
              moduleTitle={c.moduleTitle}
              score={c.score}
              dateStr={
                formatDate(c.passedAt, tenantTimezone, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }) || ""
              }
              verifyUrl={`${siteConfig.url}/verify/${signCertificate({
                tenantId: traceyTenantId,
                userId: lmsUser.id,
                moduleId: c.moduleId,
              })}`}
            />
          </div>
        ))
      )}
    </div>
  );
}
