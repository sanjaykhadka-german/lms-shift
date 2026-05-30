import { requireAdmin } from "~/lib/auth/admin";
import { loadAuditLog } from "~/lib/lms/queries/audit-log";
import { formatDateTime } from "~/lib/format/datetime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { PageHeader } from "~/components/page-header";
import { PruneForm } from "./PruneForm";

export const metadata = { title: "Audit logs" };

interface SearchParams {
  pruned?: string;
  days?: string;
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;

  const rows = await loadAuditLog(ctx);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        description={
          <>
            Unified view of Tracey-side <code>app.audit_events</code> (subscription
            + invitation events) and Flask-side <code>public.audit_logs</code>{" "}
            (admin actions). Showing the most recent 300.
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href="/app/admin/audit-logs/csv">Export CSV</a>
            </Button>
            <PruneForm />
          </div>
        }
      />

      {sp.pruned !== undefined && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          Pruned {sp.pruned} audit log row{sp.pruned === "1" ? "" : "s"} older than{" "}
          {sp.days ?? "365"} days.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent events ({rows.length})</CardTitle>
          <CardDescription>
            Tracey events surface in the platform-admin /platform/audit page too;
            this page is the per-tenant slice.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">When</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-6 py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No audit events yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-6 py-2 align-middle">
                        {formatDateTime(r.createdAt, ctx.tenantTimezone)}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <Badge variant={r.source === "tracey" ? "default" : "secondary"}>
                          {r.source}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 align-middle">{r.actorEmail ?? "—"}</td>
                      <td className="px-3 py-2 align-middle">
                        <code className="text-xs">{r.action}</code>
                      </td>
                      <td className="px-3 py-2 align-middle text-xs">{r.entity}</td>
                      <td className="px-6 py-2 align-middle text-xs text-[color:var(--muted-foreground)] max-w-md truncate">
                        {r.summary}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
