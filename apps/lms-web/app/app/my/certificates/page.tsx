import Link from "next/link";
import { Award } from "lucide-react";
import { requireLearner } from "~/lib/lms/learner";
import { listEarnedCertificates } from "~/lib/lms/certificates";
import { Button } from "~/components/ui/button";

export const metadata = { title: "Certificates" };

export default async function CertificatesPage() {
  const { lmsUser, traceyTenantId, tenantTimezone } = await requireLearner();
  const certs = await listEarnedCertificates(lmsUser.id, traceyTenantId);
  const fmt = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeZone: tenantTimezone,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Award className="h-6 w-6 text-[color:var(--primary)]" strokeWidth={2} />
            My certificates
          </h1>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            A certificate is issued for every module you pass. View or print any of them.
          </p>
        </div>
        {certs.length > 0 && (
          <Button asChild variant="outline">
            <Link href="/app/my/certificates/print-all">Print all</Link>
          </Button>
        )}
      </header>

      {certs.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-[color:var(--muted-foreground)]">
          You haven&apos;t earned any certificates yet. Pass a module&apos;s quiz to earn one.
          <div className="mt-4">
            <Button asChild>
              <Link href="/app/my/modules">Go to my training</Link>
            </Button>
          </div>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card shadow-sm">
          {certs.map((c) => (
            <li
              key={c.moduleId}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div>
                <div className="font-medium">{c.moduleTitle}</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Passed {fmt.format(c.passedAt)} · score {c.score}%
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/my/certificates/${c.moduleId}`}>View</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
