import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { ALERT_TONE } from "~/lib/badges";
import { Button } from "~/components/ui/button";
import { getManagedLocationIds, scopeArray } from "~/lib/manager-scope";

export const metadata = { title: "Coverage gaps · ShiftCraft" };

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtDayKey(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function CoveragePage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const me = await requireUser();

  const now = new Date();

  // AUDIT.md #13 — location-scope filter for managers. Owners + unscoped
  // admins get the full tenant view; scoped admins only see gaps at
  // their assigned locations.
  const scope = await getManagedLocationIds(
    membership.tenant.id,
    me.id,
    membership.role,
  );
  const scopeIds = scopeArray(scope);

  // Future published shifts with no accepted assignment. The "no accepted"
  // condition uses a NOT EXISTS subquery for clarity; outstanding "offered"
  // rows still count as a gap because they're not confirmed yet.
  const rows = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        locationName: scLocations.name,
        offeredCount: sql<number>`(
          SELECT count(*)::int FROM ${scShiftAssignments}
          WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
            AND ${scShiftAssignments.status} = 'offered'
        )`,
      })
      .from(scShifts)
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShifts.traceyTenantId, membership.tenant.id),
          eq(scShifts.status, "published"),
          gte(scShifts.startsAt, now),
          scopeIds
            ? sql`${scShifts.locationId} = ANY(${scopeIds})`
            : undefined,
          sql`NOT EXISTS (
            SELECT 1 FROM ${scShiftAssignments}
            WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
              AND ${scShiftAssignments.status} = 'accepted'
          )`,
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );

  // Group by day for scannability.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = fmtDayKey(r.startsAt);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Coverage gaps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Published future shifts with no one accepted yet.{" "}
            {rows.length === 0
              ? "All covered — nothing to chase."
              : `${rows.length} shift${rows.length === 1 ? "" : "s"} need attention.`}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/schedule">Schedule →</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <section
          className={`flex items-center gap-3 rounded-lg border-2 px-5 py-4 text-sm font-medium ${ALERT_TONE.success.solid}`}
        >
          <span
            aria-hidden
            className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${ALERT_TONE.success.accent}`}
          >
            ✓
          </span>
          <span>
            Every published upcoming shift has at least one accepted
            assignment.
          </span>
        </section>
      ) : (
        <div className="space-y-4">
          {Array.from(groups.entries()).map(([day, dayRows]) => (
            <section
              key={day}
              className="overflow-hidden rounded-lg border border-amber-200 bg-card shadow-sm dark:border-amber-900/40"
            >
              <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900/40 dark:bg-amber-900/20">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-[10px] font-bold text-amber-900 dark:bg-amber-800/60 dark:text-amber-100"
                  >
                    !
                  </span>
                  <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    {day}
                  </h2>
                </div>
                <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  {dayRows.length} gap{dayRows.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {dayRows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {fmtTime(r.startsAt)} – {fmtTime(r.endsAt)} · {r.role}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.locationName ?? "—"} ·{" "}
                        {r.offeredCount > 0
                          ? `${r.offeredCount} pending offer${r.offeredCount === 1 ? "" : "s"}`
                          : "no offers sent"}
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/schedule/${r.id}/edit`}>
                        {r.offeredCount > 0 ? "Review" : "Assign"} →
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
                Tip: shifts shown here include those with pending offers — they
                still count as "uncovered" until someone accepts.
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
