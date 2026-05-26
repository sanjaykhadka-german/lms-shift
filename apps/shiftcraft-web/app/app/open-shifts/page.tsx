import { redirect } from "next/navigation";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { claimShiftAction } from "./actions";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Open shifts · ShiftCraft" };

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

export default async function OpenShiftsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const now = new Date();
  const tenantId = membership.tenant.id;

  // Open shift = published, in the future, zero accepted assignments.
  // Same NOT EXISTS pattern as coverage-gaps.
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        locationName: scLocations.name,
        locationColor: scLocations.color,
        // Whether the calling user has any assignment row on this shift
        // (accepted, offered, declined…) — used to suppress the Claim
        // button so users can't fight their own existing offer.
        hasAnyMine: sql<boolean>`EXISTS (
          SELECT 1 FROM ${scShiftAssignments}
          WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
            AND ${scShiftAssignments.userId} = ${user.id}
        )`,
      })
      .from(scShifts)
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          eq(scShifts.status, "published"),
          gte(scShifts.startsAt, now),
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
      <div>
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          Open shifts
          <InfoPopover label="About open shifts">
            <p>
              Published shifts with no accepted assignment yet. First
              worker to claim takes the shift; once accepted it
              disappears from this list.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Published shifts with no one accepted yet. Claim one to add it to
          your roster — managers will be notified.
        </p>
      </div>

      {rows.length === 0 ? (
        <section className="flex items-center gap-3 rounded-lg border-2 border-emerald-500/60 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/50 dark:text-emerald-100">
          <span
            aria-hidden
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white"
          >
            ✓
          </span>
          <span>
            Every published upcoming shift has at least one accepted
            assignment. Nothing to pick up.
          </span>
        </section>
      ) : (
        <div className="space-y-4">
          {Array.from(groups.entries()).map(([day, dayRows]) => (
            <section
              key={day}
              className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold">{day}</h2>
                <span className="text-xs text-muted-foreground">
                  {dayRows.length} open
                </span>
              </div>
              <ul className="divide-y divide-border">
                {dayRows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                    style={
                      r.locationColor
                        ? { boxShadow: `inset 3px 0 0 ${r.locationColor}` }
                        : undefined
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {r.locationColor && (
                          <span
                            aria-hidden
                            className="h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: r.locationColor }}
                          />
                        )}
                        <span>
                          {fmtTime(r.startsAt)} – {fmtTime(r.endsAt)} ·{" "}
                          {r.role}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.locationName ?? "Unspecified location"}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </div>
                    </div>
                    {r.hasAnyMine ? (
                      <span className="text-xs text-muted-foreground">
                        On your radar
                      </span>
                    ) : (
                      <form action={claimShiftAction}>
                        <input
                          type="hidden"
                          name="shiftId"
                          value={r.id}
                        />
                        <Button type="submit" size="sm">
                          Claim
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              <p className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
                {fmtDate(dayRows[0]!.startsAt)} · click Claim to accept a
                shift immediately — no manager round-trip needed.
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
