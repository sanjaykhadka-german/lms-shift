import Link from "next/link";
import { requireAdmin } from "~/lib/auth/admin";
import { listAllCertificates } from "~/lib/lms/certificates";
import { formatDate } from "~/lib/format/datetime";
import { PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";

export const metadata = { title: "Certificates" };

export default async function AdminCertificatesPage() {
  const ctx = await requireAdmin();
  const rows = await listAllCertificates(ctx.traceyTenantId);
  const fmt = (d: Date) =>
    formatDate(d, ctx.tenantTimezone, { year: "numeric", month: "short", day: "numeric" }) || "—";

  return (
    <div className="mx-auto max-w-[1800px] space-y-8 px-4 py-10">
      <PageHeader
        title="Certificates"
        description="Every certificate earned across your workspace. Issued automatically when an employee passes a module."
        badge={
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            Compliance
          </span>
        }
        actions={
          rows.length > 0 ? (
            <Button asChild variant="outline">
              <a href="/app/admin/certificates/csv">Export CSV</a>
            </Button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-8 text-center text-sm text-[color:var(--muted-foreground)]">
          No certificates earned yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)]">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
              <tr className="border-b border-[color:var(--border)]">
                <th className="px-6 py-3">Employee</th>
                <th className="px-3 py-3">Module</th>
                <th className="px-3 py-3">Passed</th>
                <th className="px-3 py-3 text-right">Score</th>
                <th className="px-6 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {rows.map((r) => (
                <tr key={`${r.userId}-${r.moduleId}`}>
                  <td className="px-6 py-3 align-middle">
                    <div className="font-medium">{r.employeeName}</div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      {r.employeeEmail}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle">{r.moduleTitle}</td>
                  <td className="px-3 py-3 align-middle text-[color:var(--muted-foreground)]">
                    {fmt(r.passedAt)}
                  </td>
                  <td className="px-3 py-3 align-middle text-right font-semibold">
                    {r.score}%
                  </td>
                  <td className="px-6 py-3 align-middle text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/app/admin/employees/${r.userId}/certificate/${r.moduleId}`}
                      >
                        Certificate
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
