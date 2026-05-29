import { CheckCircle2, XCircle } from "lucide-react";
import { verifyCertificateToken } from "~/lib/lms/certificate-token";
import { getCertificateForVerification } from "~/lib/lms/certificates";
import { formatDate } from "~/lib/format/datetime";
import { siteConfig } from "~/lib/site-config";

export const metadata = { title: "Verify certificate" };

// Public route (no auth) — anyone with the token/link can confirm a
// certificate is authentic. The token is HMAC-signed; we re-check the
// signature, then confirm the certificate still exists in the database.
export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ref = verifyCertificateToken(token);
  const cert = ref ? await getCertificateForVerification(ref) : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span
            className="text-[2.4rem] leading-none tracking-tight"
            style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
          >
            {siteConfig.name}
          </span>
        </div>

        {cert ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" strokeWidth={1.5} />
            <h1 className="mt-4 text-xl font-semibold tracking-tight">Certificate verified</h1>
            <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">
              This is a genuine certificate of completion.
            </p>
            <dl className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm">
              <Row label="Recipient" value={cert.recipientName} />
              <Row label="Module" value={cert.moduleTitle} />
              <Row
                label="Completed"
                value={
                  formatDate(cert.passedAt, "Australia/Sydney", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  }) || "—"
                }
              />
              <Row label="Score" value={`${cert.score}%`} />
            </dl>
          </div>
        ) : (
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-8 text-center">
            <XCircle className="mx-auto h-12 w-12 text-red-600" strokeWidth={1.5} />
            <h1 className="mt-4 text-xl font-semibold tracking-tight">
              Could not verify
            </h1>
            <p className="mt-4 text-sm text-[color:var(--muted-foreground)]">
              This certificate link is invalid, has been altered, or the certificate
              no longer exists.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[color:var(--border)] pb-2">
      <dt className="text-[color:var(--muted-foreground)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
