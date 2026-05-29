import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLearner } from "~/lib/lms/learner";
import { currentMembership } from "~/lib/auth/current";
import { getEarnedCertificate } from "~/lib/lms/certificates";
import { Button } from "~/components/ui/button";
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Toolbar — hidden when printing */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/my/certificates">← Certificates</Link>
        </Button>
        <PrintButton />
      </div>

      {/* The certificate itself */}
      <div className="rounded-xl border-[6px] border-[color:var(--primary)]/70 bg-white px-10 py-14 text-center shadow-sm print:border print:shadow-none">
        {workspace && (
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
            {workspace}
          </div>
        )}
        <h1
          className="mt-6 text-4xl tracking-tight text-[color:var(--foreground)]"
          style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
        >
          Certificate of Completion
        </h1>
        <p className="mt-10 text-sm uppercase tracking-wider text-[color:var(--muted-foreground)]">
          This certifies that
        </p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--foreground)]">
          {learnerName}
        </p>
        <p className="mt-8 text-sm uppercase tracking-wider text-[color:var(--muted-foreground)]">
          has successfully completed
        </p>
        <p className="mt-2 text-2xl font-medium text-[color:var(--foreground)]">
          {cert.moduleTitle}
        </p>

        <div className="mx-auto mt-12 flex max-w-md items-center justify-between border-t pt-6 text-sm text-[color:var(--muted-foreground)]">
          <div>
            <div className="font-medium text-[color:var(--foreground)]">{dateStr}</div>
            <div className="text-xs uppercase tracking-wider">Date</div>
          </div>
          <div>
            <div className="font-medium text-[color:var(--foreground)]">{cert.score}%</div>
            <div className="text-xs uppercase tracking-wider">Score</div>
          </div>
        </div>
      </div>
    </div>
  );
}
