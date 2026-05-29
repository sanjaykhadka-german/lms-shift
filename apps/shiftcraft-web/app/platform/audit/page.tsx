import Link from "next/link";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { auditEvents, db, tenants } from "@tracey/db";

export const metadata = { title: "Audit · Platform" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function actionTone(action: string): string {
  if (action.endsWith(".deleted") || action.endsWith(".revoked")) {
    return "bg-[var(--danger)] text-white";
  }
  if (action.endsWith(".approved")) return "bg-[var(--live)] text-white";
  if (action.endsWith(".disputed")) return "bg-[var(--warn)] text-white";
  if (
    action.endsWith(".created") ||
    action.endsWith(".added") ||
    action.endsWith(".invited") ||
    action.endsWith(".paired") ||
    action.endsWith(".restored")
  ) {
    return "bg-[var(--accent-deep)] text-[var(--accent-ink)]";
  }
  return "bg-[var(--ink-3)] text-white";
}

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenant?: string;
    scope?: string;
    page?: string;
  }>;
}) {
  const { tenant: tenantFilter, scope, page: pageRaw } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Default `scope=shiftcraft` filters to the shiftcraft.* audit actions
  // (kiosk pair/revoke/restore/delete, PIN set/removed, member invited,
  // etc.). `scope=all` shows every event regardless of which app wrote it.
  const onlyShiftcraft = scope !== "all";

  const where = and(
    tenantFilter ? eq(auditEvents.tenantId, tenantFilter) : undefined,
    onlyShiftcraft
      ? like(auditEvents.action, "shiftcraft.%")
      : undefined,
  );

  const [rows, totalRows, tenantsList] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        tenantId: auditEvents.tenantId,
        action: auditEvents.action,
        actorEmail: auditEvents.actorEmail,
        targetKind: auditEvents.targetKind,
        targetId: auditEvents.targetId,
        details: auditEvents.details,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(where),
    db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants),
  ]);

  const total = totalRows[0]?.c ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tenantNameById = new Map(
    tenantsList.map((t) => [t.id, t.name] as const),
  );

  const qsFor = (overrides: {
    tenant?: string | null;
    scope?: string | null;
    page?: number;
  }) => {
    const params = new URLSearchParams();
    const t =
      overrides.tenant === null
        ? undefined
        : (overrides.tenant ?? tenantFilter);
    if (t) params.set("tenant", t);
    const s = overrides.scope === null ? undefined : (overrides.scope ?? scope);
    if (s) params.set("scope", s);
    if (overrides.page && overrides.page > 1) {
      params.set("page", String(overrides.page));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-10">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Cross-tenant activity recorded in <code>app.audit_events</code>.
          Default scope is ShiftCraft actions only.
        </p>
      </div>

      <form
        method="get"
        action="/platform/audit"
        className="flex flex-wrap items-end gap-2 text-sm"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Tenant</span>
          <select
            name="tenant"
            defaultValue={tenantFilter ?? ""}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All tenants</option>
            {tenantsList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Scope</span>
          <select
            name="scope"
            defaultValue={onlyShiftcraft ? "shiftcraft" : "all"}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="shiftcraft">ShiftCraft actions</option>
            <option value="all">All actions</option>
          </select>
        </label>
        <button
          type="submit"
          className="h-8 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          Apply
        </button>
        {tenantFilter || scope === "all" ? (
          <Link
            href="/platform/audit"
            className="h-8 rounded-md px-3 text-sm font-medium leading-8 text-muted-foreground hover:bg-muted"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {total} {total === 1 ? "event" : "events"}
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {page} of {lastPage}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No audit events match. Try changing the filters above.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${actionTone(r.action)}`}
                  >
                    {r.action}
                  </span>
                  {r.targetKind ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.targetKind}
                      {r.targetId ? `:${r.targetId.slice(0, 8)}` : ""}
                    </span>
                  ) : null}
                  {r.tenantId ? (
                    <Link
                      href={`/platform/tenants/${r.tenantId}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {tenantNameById.get(r.tenantId) ?? r.tenantId.slice(0, 8)}
                    </Link>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtWhen(r.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.actorEmail ?? "system"}
                </div>
                {r.details != null ? (
                  <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                    {JSON.stringify(r.details, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {lastPage > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-5 py-2 text-xs">
            <span className="text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
              {total}
            </span>
            <div className="flex items-center gap-2">
              <Link
                aria-disabled={page <= 1}
                href={`/platform/audit${qsFor({ page: Math.max(1, page - 1) })}`}
                className={
                  page <= 1
                    ? "pointer-events-none rounded-md border border-border px-3 py-1 text-muted-foreground opacity-40"
                    : "rounded-md border border-border px-3 py-1 hover:bg-muted"
                }
              >
                ← Prev
              </Link>
              <Link
                aria-disabled={page >= lastPage}
                href={`/platform/audit${qsFor({ page: Math.min(lastPage, page + 1) })}`}
                className={
                  page >= lastPage
                    ? "pointer-events-none rounded-md border border-border px-3 py-1 text-muted-foreground opacity-40"
                    : "rounded-md border border-border px-3 py-1 hover:bg-muted"
                }
              >
                Next →
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
