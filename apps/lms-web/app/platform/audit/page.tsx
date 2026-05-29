import Link from "next/link";
import { desc, eq, lt } from "drizzle-orm";
import { db, auditEvents, tenants } from "@tracey/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDateTime } from "~/lib/format/datetime";

const PAGE_SIZE = 200;

interface PageProps {
  searchParams: Promise<{ before?: string }>;
}

export default async function PlatformAuditPage({ searchParams }: PageProps) {
  const { before } = await searchParams;
  const beforeDate = before ? new Date(before) : null;
  const cursorOk = beforeDate && !Number.isNaN(beforeDate.getTime());

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorEmail: auditEvents.actorEmail,
      targetKind: auditEvents.targetKind,
      targetId: auditEvents.targetId,
      details: auditEvents.details,
      createdAt: auditEvents.createdAt,
      tenantId: auditEvents.tenantId,
      tenantName: tenants.name,
      tenantTimezone: tenants.timezone,
    })
    .from(auditEvents)
    .leftJoin(tenants, eq(tenants.id, auditEvents.tenantId))
    .where(cursorOk ? lt(auditEvents.createdAt, beforeDate!) : undefined)
    .orderBy(desc(auditEvents.createdAt))
    .limit(PAGE_SIZE);

  const last = rows[rows.length - 1];
  const hasMore = rows.length === PAGE_SIZE && last;
  const olderHref = hasMore
    ? `/platform/audit?before=${encodeURIComponent(last.createdAt.toISOString())}`
    : null;

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Sensitive actions across every tenant, newest first.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {rows.length} {rows.length === 1 ? "event" : "events"}
            {cursorOk && (
              <span className="ml-2 text-sm font-normal text-[color:var(--muted-foreground)]">
                before {formatDateTime(beforeDate, null)}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Hooked actions: tenant.created · invitation.created · invitation.revoked · member.joined · subscription.changed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-3 text-sm text-[color:var(--muted-foreground)]">
              No events {cursorOk ? "before this point" : "yet"}.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {rows.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <code className="text-xs font-medium">{e.action}</code>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {formatDateTime(e.createdAt, e.tenantTimezone)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {e.tenantId ? (
                      <Link
                        href={`/platform/tenants/${e.tenantId}`}
                        className="font-medium hover:underline"
                      >
                        {e.tenantName ?? "(deleted tenant)"}
                      </Link>
                    ) : (
                      <span>(no tenant)</span>
                    )}
                    {" · "}
                    {e.actorEmail ?? "system"}
                    {e.targetKind && (
                      <>
                        {" · "}
                        {e.targetKind}
                        {e.targetId && <code className="ml-1">{e.targetId.slice(0, 8)}</code>}
                      </>
                    )}
                  </div>
                  {e.details ? (
                    <pre className="mt-1 overflow-x-auto rounded bg-[color:var(--secondary)] px-2 py-1 text-[11px]">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between text-sm">
        {cursorOk ? (
          <Link href="/platform/audit" className="text-[color:var(--muted-foreground)] hover:underline">
            ← Newest
          </Link>
        ) : (
          <span />
        )}
        {olderHref ? (
          <Link href={olderHref} className="text-[color:var(--muted-foreground)] hover:underline">
            Older →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
