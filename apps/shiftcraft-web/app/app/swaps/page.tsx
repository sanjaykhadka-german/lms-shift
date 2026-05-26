import Link from "next/link";
import { redirect } from "next/navigation";
import { aliasedTable, and, desc, eq, or } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
  scShiftSwapRequests,
  users,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Swap requests · ShiftCraft" };

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500 text-white",
  accepted: "bg-emerald-600 text-white",
  declined: "bg-rose-600 text-white",
  cancelled: "bg-slate-500 text-white",
};

type StatusFilter = "all" | "pending" | "accepted" | "declined" | "cancelled";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
];

function fmt(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SwapsAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (membership.role !== "admin" && membership.role !== "owner") {
    redirect("/app");
  }

  const sp = await searchParams;
  const status: StatusFilter =
    sp.status === "pending" ||
    sp.status === "accepted" ||
    sp.status === "declined" ||
    sp.status === "cancelled"
      ? sp.status
      : "all";

  // Two aliases for users since we join twice (initiator + target).
  const initiatorUsers = aliasedTable(users, "initiator_users");
  const targetUsers = aliasedTable(users, "target_users");

  const whereConditions = [
    eq(scShiftSwapRequests.traceyTenantId, membership.tenant.id),
  ];
  if (status !== "all") {
    whereConditions.push(eq(scShiftSwapRequests.status, status));
  }

  const rows = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        swapId: scShiftSwapRequests.id,
        swapStatus: scShiftSwapRequests.status,
        note: scShiftSwapRequests.note,
        createdAt: scShiftSwapRequests.createdAt,
        decidedAt: scShiftSwapRequests.decidedAt,
        initiatorName: initiatorUsers.name,
        initiatorEmail: initiatorUsers.email,
        targetName: targetUsers.name,
        targetEmail: targetUsers.email,
        initiatorAssignmentId: scShiftSwapRequests.initiatorAssignmentId,
        targetAssignmentId: scShiftSwapRequests.targetAssignmentId,
      })
      .from(scShiftSwapRequests)
      .innerJoin(
        initiatorUsers,
        eq(initiatorUsers.id, scShiftSwapRequests.initiatorUserId),
      )
      .innerJoin(
        targetUsers,
        eq(targetUsers.id, scShiftSwapRequests.targetUserId),
      )
      .where(and(...whereConditions))
      .orderBy(desc(scShiftSwapRequests.createdAt)),
  );

  // Fetch shift details for all referenced assignments in one query.
  const assignmentIds = new Set<string>();
  for (const r of rows) {
    assignmentIds.add(r.initiatorAssignmentId);
    if (r.targetAssignmentId) assignmentIds.add(r.targetAssignmentId);
  }
  const shiftMap = new Map<
    string,
    { startsAt: Date; role: string; locationName: string | null }
  >();
  if (assignmentIds.size > 0) {
    const detailRows = await forTenant(membership.tenant.id).run((tx) =>
      tx
        .select({
          assignmentId: scShiftAssignments.id,
          startsAt: scShifts.startsAt,
          role: scShifts.role,
          locationName: scLocations.name,
        })
        .from(scShiftAssignments)
        .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
        .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
        .where(
          or(
            ...Array.from(assignmentIds).map((id) =>
              eq(scShiftAssignments.id, id),
            ),
          ),
        ),
    );
    for (const d of detailRows) {
      shiftMap.set(d.assignmentId, {
        startsAt: d.startsAt,
        role: d.role,
        locationName: d.locationName,
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          Swap requests
          <InfoPopover label="About swap requests">
            <p>
              Workers ask each other to <strong>cover</strong> a shift
              (one-way handoff) or <strong>swap</strong> (two-way trade).
              On accept, the linked assignments flip atomically.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tenant-wide audit of cover and swap requests between employees.
          Read-only — employees accept or decline from their My shifts page.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/app/swaps" : `/app/swaps?status=${f.value}`}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No swap requests match this filter.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const giveaway = shiftMap.get(r.initiatorAssignmentId);
              const receive = r.targetAssignmentId
                ? shiftMap.get(r.targetAssignmentId)
                : null;
              const isSwap = r.targetAssignmentId !== null;
              return (
                <li key={r.swapId} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm">
                        <span className="font-medium">
                          {r.initiatorName ?? r.initiatorEmail}
                        </span>
                        {isSwap ? " ↔ " : " → "}
                        <span className="font-medium">
                          {r.targetName ?? r.targetEmail}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {isSwap ? "Swap" : "Cover"}
                        </span>
                      </div>
                      {giveaway && (
                        <div className="text-xs text-muted-foreground">
                          Initiator gives up:{" "}
                          <span className="text-foreground">
                            {fmt(giveaway.startsAt)} · {giveaway.role}
                            {giveaway.locationName
                              ? ` @ ${giveaway.locationName}`
                              : ""}
                          </span>
                        </div>
                      )}
                      {receive && (
                        <div className="text-xs text-muted-foreground">
                          In exchange for:{" "}
                          <span className="text-foreground">
                            {fmt(receive.startsAt)} · {receive.role}
                            {receive.locationName
                              ? ` @ ${receive.locationName}`
                              : ""}
                          </span>
                        </div>
                      )}
                      {r.note && (
                        <p className="text-xs text-muted-foreground">
                          "{r.note}"
                        </p>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        Created {fmt(r.createdAt)}
                        {r.decidedAt ? ` · resolved ${fmt(r.decidedAt)}` : ""}
                      </div>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        STATUS_BADGE[r.swapStatus] ?? ""
                      }`}
                    >
                      {r.swapStatus}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
