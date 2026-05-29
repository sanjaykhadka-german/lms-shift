import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { auditEvents, db } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Audit log · ShiftCraft" };

const PAGE_SIZE = 50;

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
  // Solid badges for clear readability under the v4 themed palette.
  if (action.endsWith(".deleted")) return "bg-[var(--danger)] text-white";
  if (action.endsWith(".approved")) return "bg-[var(--live)] text-white";
  if (action.endsWith(".disputed")) return "bg-[var(--warn)] text-white";
  if (action.endsWith(".created") || action.endsWith(".added"))
    return "bg-[var(--accent-deep)] text-[var(--accent-ink)]";
  return "bg-[var(--ink-3)] text-white";
}

function parseDate(raw: string | undefined, endOfDay: boolean): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const {
    action: actionFilter,
    page: pageRaw,
    from: fromRaw,
    to: toRaw,
  } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const fromDate = parseDate(fromRaw, false);
  const toDate = parseDate(toRaw, true);

  const where = and(
    eq(auditEvents.tenantId, membership.tenant.id),
    actionFilter && actionFilter.length > 0
      ? eq(auditEvents.action, actionFilter)
      : undefined,
    fromDate ? gte(auditEvents.createdAt, fromDate) : undefined,
    toDate ? lte(auditEvents.createdAt, toDate) : undefined,
  );

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(where),
  ]);
  const total = totalRows[0]?.c ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Distinct actions for the filter dropdown — capped at 50 to avoid
  // pulling thousands of distinct values; this is plenty for a single
  // tenant's audit history.
  const distinctActions = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, membership.tenant.id))
    .groupBy(auditEvents.action)
    .orderBy(auditEvents.action)
    .limit(50);

  const qsFor = (overrides: {
    action?: string | null;
    page?: number;
    from?: string | null;
    to?: string | null;
  }) => {
    const params = new URLSearchParams();
    const act =
      overrides.action === null ? undefined : (overrides.action ?? actionFilter);
    if (act) params.set("action", act);
    const f =
      overrides.from === null ? undefined : (overrides.from ?? fromRaw);
    if (f) params.set("from", f);
    const t =
      overrides.to === null ? undefined : (overrides.to ?? toRaw);
    if (t) params.set("to", t);
    if (overrides.page && overrides.page > 1)
      params.set("page", String(overrides.page));
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const hasAnyFilter = !!(actionFilter || fromRaw || toRaw);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Audit log
          <InfoPopover label="About the audit log">
            <p>
              Append-only record of every sensitive action across the
              workspace — sign-ins, role changes, PII reveals, payroll
              exports, manager-scope grants. Filter by actor or action
              kind.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sensitive activity for {membership.tenant.name}. Append-only — every
          row is preserved even if its actor or target is later removed.
        </p>
      </div>

      <form
        action="/app/audit"
        method="get"
        className="flex flex-wrap items-end gap-2 text-sm"
      >
        <div className="space-y-1">
          <label
            htmlFor="action-filter"
            className="block text-xs uppercase tracking-wider text-muted-foreground"
          >
            Action
          </label>
          <select
            id="action-filter"
            name="action"
            defaultValue={actionFilter ?? ""}
            className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="">All actions</option>
            {distinctActions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="audit-from"
            className="block text-xs uppercase tracking-wider text-muted-foreground"
          >
            From
          </label>
          <input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={fromRaw ?? ""}
            className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="audit-to"
            className="block text-xs uppercase tracking-wider text-muted-foreground"
          >
            To
          </label>
          <input
            id="audit-to"
            name="to"
            type="date"
            defaultValue={toRaw ?? ""}
            className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        {hasAnyFilter ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/audit">Clear</Link>
          </Button>
        ) : null}
      </form>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {hasAnyFilter ? `Filtered events` : `All events`}{" "}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              · {total} total
            </span>
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {page} of {lastPage}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No audit events match. Try changing the filter — or perform an
            action somewhere in the app to generate a row.
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
                  {r.targetKind && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.targetKind}
                      {r.targetId ? `:${r.targetId.slice(0, 8)}` : ""}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtWhen(r.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Actor:{" "}
                  <span className="font-medium text-foreground">
                    {r.actorEmail ?? "system"}
                  </span>
                </div>
                {r.details != null && (
                  <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                    {JSON.stringify(r.details, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
        {lastPage > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-2 text-xs">
            <span className="text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
              {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                disabled={page <= 1}
              >
                <Link
                  href={`/app/audit${qsFor({ page: Math.max(1, page - 1) })}`}
                >
                  ← Prev
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
              >
                <Link
                  href={`/app/audit${qsFor({ page: Math.min(lastPage, page + 1) })}`}
                >
                  Next →
                </Link>
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
