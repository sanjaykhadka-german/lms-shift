import Link from "next/link";
import { requireLearner } from "~/lib/lms/learner";
import { currentMembership } from "~/lib/auth/current";
import { listEarnedCertificates } from "~/lib/lms/certificates";
import { formatDate } from "~/lib/format/datetime";
import { Button } from "~/components/ui/button";
import { TranscriptDocument } from "~/components/transcript-document";
import { PrintButton } from "../certificates/_print-button";

export const metadata = { title: "Training transcript" };

export default async function MyTranscriptPage() {
  const { lmsUser, traceyTenantId, tenantTimezone } = await requireLearner();
  const certs = await listEarnedCertificates(lmsUser.id, traceyTenantId);
  const membership = await currentMembership();

  const fmt = (d: Date) =>
    formatDate(d, tenantTimezone, { year: "numeric", month: "short", day: "numeric" }) || "—";
  const generated =
    formatDate(new Date(), tenantTimezone, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }) || "";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/my/modules">← My training</Link>
        </Button>
        <PrintButton />
      </div>

      <TranscriptDocument
        workspace={membership?.tenant.name ?? ""}
        recipientName={lmsUser.name?.trim() || lmsUser.email}
        recipientEmail={lmsUser.email}
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
