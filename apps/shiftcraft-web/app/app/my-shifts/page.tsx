import { redirect } from "next/navigation";
import { and, asc, desc, eq, gt, or } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scLocations,
  scShiftAssignments,
  scShifts,
  scShiftSwapRequests,
  users,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { Badge, type BadgeProps } from "~/components/ui/badge";
import {
  acceptOfferAction,
  declineOfferAction,
} from "../schedule/actions";
import {
  acceptSwapAction,
  cancelSwapAction,
  declineSwapAction,
} from "./swap-actions";
import { SwapForms } from "./_swap-forms";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "My shifts · ShiftCraft" };

const ASSIGN_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  offered: "warn",
  accepted: "live",
  declined: "danger",
  swapped: "open",
  no_show: "danger",
};

function fmt(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MyShiftsPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const user = await requireUser();
  const now = new Date();

  const rows = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        assignmentId: scShiftAssignments.id,
        assignmentStatus: scShiftAssignments.status,
        respondedAt: scShiftAssignments.respondedAt,
        shiftId: scShifts.id,
        shiftStatus: scShifts.status,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.userId, user.id),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );

  const pending = rows.filter((r) => r.assignmentStatus === "offered");
  const upcoming = rows.filter(
    (r) =>
      r.assignmentStatus === "accepted" &&
      r.shiftStatus !== "cancelled" &&
      r.startsAt >= now,
  );
  const past = rows.filter(
    (r) => r.startsAt < now || r.assignmentStatus === "declined",
  );

  // Teammates (tenant members minus self) — for the swap-target picker.
  const teammateRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.tenantId, membership.tenant.id))
    .orderBy(asc(users.name), asc(users.email));
  const teammates = teammateRows.filter((t) => t.id !== user.id);

  // Teammates' upcoming accepted shifts — for the swap-shift picker. We pass
  // ISO strings to the client component so it stays serialisable.
  const teammateShiftRows = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        assignmentId: scShiftAssignments.id,
        userId: scShiftAssignments.userId,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.status, "accepted"),
          gt(scShifts.startsAt, now),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  const teammateShifts = teammateShiftRows
    .filter((s) => s.userId !== user.id)
    .map((s) => ({
      assignmentId: s.assignmentId,
      userId: s.userId,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      role: s.role,
      locationName: s.locationName,
    }));

  // Incoming swap requests — pending swaps where I'm the target.
  const initiatorUsers = users;
  const incomingSwaps = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        swapId: scShiftSwapRequests.id,
        note: scShiftSwapRequests.note,
        createdAt: scShiftSwapRequests.createdAt,
        initiatorUserId: scShiftSwapRequests.initiatorUserId,
        initiatorName: initiatorUsers.name,
        initiatorEmail: initiatorUsers.email,
        initiatorAssignmentId: scShiftSwapRequests.initiatorAssignmentId,
        targetAssignmentId: scShiftSwapRequests.targetAssignmentId,
      })
      .from(scShiftSwapRequests)
      .innerJoin(
        initiatorUsers,
        eq(initiatorUsers.id, scShiftSwapRequests.initiatorUserId),
      )
      .where(
        and(
          eq(scShiftSwapRequests.targetUserId, user.id),
          eq(scShiftSwapRequests.status, "pending"),
        ),
      )
      .orderBy(desc(scShiftSwapRequests.createdAt)),
  );

  // Outgoing swap requests — pending swaps I initiated.
  const outgoingSwaps = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        swapId: scShiftSwapRequests.id,
        note: scShiftSwapRequests.note,
        createdAt: scShiftSwapRequests.createdAt,
        targetUserId: scShiftSwapRequests.targetUserId,
        targetName: users.name,
        targetEmail: users.email,
        initiatorAssignmentId: scShiftSwapRequests.initiatorAssignmentId,
        targetAssignmentId: scShiftSwapRequests.targetAssignmentId,
      })
      .from(scShiftSwapRequests)
      .innerJoin(users, eq(users.id, scShiftSwapRequests.targetUserId))
      .where(
        and(
          eq(scShiftSwapRequests.initiatorUserId, user.id),
          eq(scShiftSwapRequests.status, "pending"),
        ),
      )
      .orderBy(desc(scShiftSwapRequests.createdAt)),
  );

  // Pull all assignment-shift pairs referenced by visible swap requests in
  // one query so the incoming/outgoing sections can render shift details.
  const swapAssignmentIds = new Set<string>();
  for (const s of incomingSwaps) {
    swapAssignmentIds.add(s.initiatorAssignmentId);
    if (s.targetAssignmentId) swapAssignmentIds.add(s.targetAssignmentId);
  }
  for (const s of outgoingSwaps) {
    swapAssignmentIds.add(s.initiatorAssignmentId);
    if (s.targetAssignmentId) swapAssignmentIds.add(s.targetAssignmentId);
  }
  const swapShiftMap = new Map<
    string,
    { startsAt: Date; endsAt: Date; role: string; locationName: string | null }
  >();
  if (swapAssignmentIds.size > 0) {
    const detailRows = await forTenant(membership.tenant.id).run((tx) =>
      tx
        .select({
          assignmentId: scShiftAssignments.id,
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          role: scShifts.role,
          locationName: scLocations.name,
        })
        .from(scShiftAssignments)
        .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
        .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
        .where(
          or(
            ...Array.from(swapAssignmentIds).map((id) =>
              eq(scShiftAssignments.id, id),
            ),
          ),
        ),
    );
    for (const d of detailRows) {
      swapShiftMap.set(d.assignmentId, {
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        role: d.role,
        locationName: d.locationName,
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          My shifts
          <InfoPopover label="About my shifts">
            <p>
              Every shift offered to or accepted by you. Tap{" "}
              <strong>Accept</strong> or <strong>Decline</strong> on
              pending offers; managers see your response immediately.
            </p>
            <p className="mt-1">
              Subscribe to your iCal feed via{" "}
              <a href="/app/settings" className="underline">
                Settings
              </a>{" "}
              to see accepted shifts in your phone calendar.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Respond to offers, manage swap requests, see what's upcoming.
        </p>
      </div>

      {incomingSwaps.length > 0 && (
        <Section
          title={`Incoming swap requests (${incomingSwaps.length})`}
          empty="—"
        >
          {incomingSwaps.map((s) => {
            const giveaway = swapShiftMap.get(s.initiatorAssignmentId);
            const receive = s.targetAssignmentId
              ? swapShiftMap.get(s.targetAssignmentId)
              : null;
            return (
              <li key={s.swapId} className="px-5 py-4 space-y-2">
                <div className="text-sm">
                  <span className="font-medium">
                    {s.initiatorName ?? s.initiatorEmail}
                  </span>{" "}
                  {s.targetAssignmentId
                    ? "wants to swap shifts."
                    : "needs cover."}
                </div>
                {giveaway && (
                  <SwapShiftLine
                    label={
                      s.targetAssignmentId
                        ? "They'd give up:"
                        : "They'd hand off:"
                    }
                    shift={giveaway}
                  />
                )}
                {receive && (
                  <SwapShiftLine
                    label="You'd take on:"
                    shift={receive}
                    important
                  />
                )}
                {s.note && (
                  <p className="text-xs text-muted-foreground">"{s.note}"</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <form action={acceptSwapAction}>
                    <input type="hidden" name="id" value={s.swapId} />
                    <Button type="submit" size="sm">
                      Accept
                    </Button>
                  </form>
                  <form action={declineSwapAction}>
                    <input type="hidden" name="id" value={s.swapId} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      Decline
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </Section>
      )}

      <Section
        title={`Offers awaiting your response (${pending.length})`}
        empty="No pending offers."
      >
        {pending.map((r) => (
          <li key={r.assignmentId} className="px-5 py-4">
            <Row row={r} />
            <div className="mt-3 flex items-center gap-2">
              <form action={acceptOfferAction}>
                <input type="hidden" name="id" value={r.assignmentId} />
                <Button type="submit" size="sm">
                  Accept
                </Button>
              </form>
              <form action={declineOfferAction}>
                <input type="hidden" name="id" value={r.assignmentId} />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  Decline
                </Button>
              </form>
            </div>
          </li>
        ))}
      </Section>

      <Section
        title={`Upcoming (${upcoming.length})`}
        empty="No upcoming shifts."
      >
        {upcoming.map((r) => (
          <li key={r.assignmentId} className="px-5 py-4 space-y-3">
            <Row row={r} />
            <SwapForms
              assignmentId={r.assignmentId}
              teammates={teammates}
              teammateShifts={teammateShifts}
            />
          </li>
        ))}
      </Section>

      {outgoingSwaps.length > 0 && (
        <Section
          title={`Your pending requests (${outgoingSwaps.length})`}
          empty="—"
        >
          {outgoingSwaps.map((s) => {
            const giveaway = swapShiftMap.get(s.initiatorAssignmentId);
            const receive = s.targetAssignmentId
              ? swapShiftMap.get(s.targetAssignmentId)
              : null;
            return (
              <li key={s.swapId} className="px-5 py-4 space-y-2">
                <div className="text-sm">
                  {s.targetAssignmentId
                    ? "Swap proposed to "
                    : "Cover requested from "}
                  <span className="font-medium">
                    {s.targetName ?? s.targetEmail}
                  </span>
                  .
                </div>
                {giveaway && (
                  <SwapShiftLine label="You'd give up:" shift={giveaway} />
                )}
                {receive && (
                  <SwapShiftLine label="You'd take on:" shift={receive} />
                )}
                {s.note && (
                  <p className="text-xs text-muted-foreground">"{s.note}"</p>
                )}
                <form action={cancelSwapAction}>
                  <input type="hidden" name="id" value={s.swapId} />
                  <Button type="submit" size="sm" variant="outline">
                    Cancel request
                  </Button>
                </form>
              </li>
            );
          })}
        </Section>
      )}

      {past.length > 0 && (
        <Section title={`Past & declined (${past.length})`} empty="—">
          {past.map((r) => (
            <li key={r.assignmentId} className="px-5 py-4 opacity-70">
              <Row row={r} />
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some((c) => !!c);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3 font-display text-base font-semibold tracking-[-0.01em] text-ink">
        {title}
      </div>
      {hasItems ? (
        <ul className="divide-y divide-border">{children}</ul>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function Row({
  row,
}: {
  row: {
    assignmentStatus: string;
    role: string;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
    locationName: string | null;
    shiftStatus: string;
  };
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">
          {fmt(row.startsAt)} – {fmt(row.endsAt).split(", ").pop()}
        </div>
        <div className="text-xs text-muted-foreground">
          {row.role}
          {row.locationName ? ` · ${row.locationName}` : ""}
          {row.shiftStatus === "cancelled" ? " · shift cancelled" : ""}
        </div>
        {row.notes && (
          <div className="mt-1 text-xs text-muted-foreground">{row.notes}</div>
        )}
      </div>
      <Badge
        variant={ASSIGN_BADGE[row.assignmentStatus] ?? "neutral"}
        size="sm"
        className="shrink-0"
      >
        {row.assignmentStatus.replace("_", " ")}
      </Badge>
    </div>
  );
}

function SwapShiftLine({
  label,
  shift,
  important = false,
}: {
  label: string;
  shift: { startsAt: Date; endsAt: Date; role: string; locationName: string | null };
  important?: boolean;
}) {
  return (
    <div
      className={`text-xs ${important ? "font-medium" : "text-muted-foreground"}`}
    >
      <span className="text-muted-foreground">{label}</span>{" "}
      {fmt(shift.startsAt)} · {shift.role}
      {shift.locationName ? ` @ ${shift.locationName}` : ""}
    </div>
  );
}
