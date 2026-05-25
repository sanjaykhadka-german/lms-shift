import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { forTenant, scLeaveTypes, scTimeOffRequests, users } from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { findAffectedShiftsForRequests } from "~/lib/time-off-impact";
import { getHolidaysForTenant, type HolidayRow } from "~/lib/holidays";
import { listActiveLeaveTypes } from "~/lib/leave-types";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import { TimeOffForm } from "./_form";
import {
  approveTimeOffAction,
  cancelOwnTimeOffAction,
  denyTimeOffAction,
} from "./actions";

export const metadata = { title: "Time off · ShiftCraft" };

type Filter = "pending" | "approved" | "denied" | "cancelled" | "all";
const FILTERS: Filter[] = ["pending", "approved", "denied", "cancelled", "all"];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500 text-white",
  approved: "bg-emerald-600 text-white",
  denied: "bg-rose-600 text-white",
  cancelled: "bg-slate-500 text-white line-through",
};

// Saturated solid backgrounds for the leave-type chip — per the
// tailwind-v4-contrast feedback, the bg-X-100/text-X-800 combo washes
// out under this theme. Slugs are stable for seeded defaults; custom
// admin-defined types fall through to the neutral default.
function leaveTypeBadge(slug: string | null): string {
  switch (slug) {
    case "annual":
      return "bg-sky-600";
    case "personal_sick":
      return "bg-rose-600";
    case "unpaid":
      return "bg-slate-600";
    case "long_service":
      return "bg-violet-600";
    case "other":
      return "bg-amber-600";
    default:
      return "bg-zinc-600";
  }
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function TimeOffPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const user = await requireUser();

  const { status: rawStatus } = await searchParams;
  const filter: Filter = (FILTERS as string[]).includes(rawStatus ?? "")
    ? (rawStatus as Filter)
    : "pending";

  const isAdmin = membership.role === "admin" || membership.role === "owner";

  const [rows, leaveTypes] = await Promise.all([
    forTenant(membership.tenant.id).run((tx) =>
      tx
        .select({
          id: scTimeOffRequests.id,
          userId: scTimeOffRequests.userId,
          startDate: scTimeOffRequests.startDate,
          endDate: scTimeOffRequests.endDate,
          reason: scTimeOffRequests.reason,
          status: scTimeOffRequests.status,
          createdAt: scTimeOffRequests.createdAt,
          userName: users.name,
          userEmail: users.email,
          leaveTypeId: scTimeOffRequests.leaveTypeId,
          leaveTypeName: scLeaveTypes.name,
          leaveTypeSlug: scLeaveTypes.slug,
        })
        .from(scTimeOffRequests)
        .leftJoin(users, eq(users.id, scTimeOffRequests.userId))
        .leftJoin(
          scLeaveTypes,
          eq(scLeaveTypes.id, scTimeOffRequests.leaveTypeId),
        )
        .where(
          filter === "all"
            ? eq(scTimeOffRequests.traceyTenantId, membership.tenant.id)
            : and(
                eq(scTimeOffRequests.traceyTenantId, membership.tenant.id),
                eq(scTimeOffRequests.status, filter),
              ),
        )
        .orderBy(desc(scTimeOffRequests.createdAt)),
    ),
    listActiveLeaveTypes(membership.tenant.id),
  ]);

  // For admins, surface which published shifts each pending request
  // would affect — accepted shifts are the obvious fallout, offered
  // shifts also disappear since the employee can't accept while on
  // leave. Computed once per request; the helper itself short-circuits
  // when the list is empty.
  const pendingForImpact = isAdmin
    ? rows.filter((r) => r.status === "pending")
    : [];
  const impactByRequest = await findAffectedShiftsForRequests(
    membership.tenant.id,
    pendingForImpact.map((r) => ({
      id: r.id,
      userId: r.userId,
      startDate: r.startDate,
      endDate: r.endDate,
    })),
  );

  // AUDIT.md #6 — fetch public holidays that fall inside the spanning
  // window of visible leave requests, once. Per-request filtering is a
  // cheap JS pass over what's typically a small array (~10 holidays
  // for any reasonable date range).
  const holidaysByRequest = new Map<string, HolidayRow[]>();
  if (rows.length > 0) {
    let minStart = rows[0]!.startDate;
    let maxEnd = rows[0]!.endDate;
    for (const r of rows) {
      if (r.startDate < minStart) minStart = r.startDate;
      if (r.endDate > maxEnd) maxEnd = r.endDate;
    }
    const windowHolidays = await getHolidaysForTenant(
      membership.tenant.id,
      minStart,
      maxEnd,
    );
    for (const r of rows) {
      const overlap = windowHolidays.filter(
        (h) => h.date >= r.startDate && h.date <= r.endDate,
      );
      if (overlap.length > 0) holidaysByRequest.set(r.id, overlap);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Time off</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Review pending requests and submit your own."
            : "Submit a request, then track its status here."}
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">Submit a request</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          {isAdmin
            ? "Admins can also submit on behalf of themselves."
            : "Your manager will review and approve or deny."}
        </p>
        <TimeOffForm
          leaveTypes={leaveTypes.map((lt) => ({ id: lt.id, name: lt.name }))}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            asChild
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
          >
            <Link href={`/app/time-off?status=${f}`}>
              {f === "all" ? "All" : f[0]!.toUpperCase() + f.slice(1)}
            </Link>
          </Button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No {filter === "all" ? "" : filter} requests.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const isOwn = r.userId === user.id;
              const canReview = isAdmin && r.status === "pending";
              const canCancel = isOwn && r.status === "pending";
              const affected = impactByRequest.get(r.id) ?? [];
              const acceptedAffected = affected.filter(
                (a) => a.status === "accepted",
              ).length;
              const offeredAffected = affected.filter(
                (a) => a.status === "offered",
              ).length;
              // AUDIT.md #6 — public holidays overlapping this request.
              // Visible to both admin and employee; the chip is purely
              // informational ("FYI this leave spans a holiday").
              const holidayOverlap = holidaysByRequest.get(r.id) ?? [];
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {r.userName ?? r.userEmail ?? "Unknown"}
                        {isOwn && (
                          <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                            You
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
                        <span>
                          {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                        </span>
                        {r.leaveTypeName && (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white ${leaveTypeBadge(r.leaveTypeSlug)}`}
                          >
                            {r.leaveTypeName}
                          </span>
                        )}
                      </div>
                      {r.reason && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {r.reason}
                        </div>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE[r.status] ?? ""}`}
                    >
                      {r.status}
                    </span>
                  </div>

                  {canReview && affected.length > 0 && (
                    <details className="mt-3 rounded-md border border-rose-500/40 bg-rose-50/60 px-3 py-2 text-xs dark:border-rose-500/30 dark:bg-rose-950/20">
                      <summary className="cursor-pointer font-medium text-rose-900 dark:text-rose-200">
                        Impact:{" "}
                        {acceptedAffected > 0 && (
                          <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                            {acceptedAffected} accepted
                          </span>
                        )}
                        {offeredAffected > 0 && (
                          <span className="ml-1 inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                            {offeredAffected} offered
                          </span>
                        )}{" "}
                        <span className="font-normal text-muted-foreground">
                          — click to see which shifts
                        </span>
                      </summary>
                      <ul className="mt-2 divide-y divide-rose-500/20">
                        {affected.map((s) => (
                          <li
                            key={s.shiftId}
                            className="flex items-center justify-between gap-3 py-1.5"
                          >
                            <span className="truncate">
                              <span className="font-medium">{s.role}</span>
                              {s.locationName ? ` · ${s.locationName}` : ""}
                            </span>
                            <span className="flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
                              {s.startsAt.toLocaleString(undefined, {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              <span
                                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                  s.status === "accepted"
                                    ? "bg-rose-600 text-white"
                                    : "bg-amber-500 text-white"
                                }`}
                              >
                                {s.status}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {canReview && affected.length === 0 && (
                    <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">
                      No published shifts assigned to this person in the
                      requested window.
                    </p>
                  )}

                  {holidayOverlap.length > 0 && (
                    <details className="mt-3 rounded-md border border-purple-500/40 bg-purple-50/60 px-3 py-2 text-xs dark:border-purple-500/30 dark:bg-purple-950/20">
                      <summary className="cursor-pointer font-medium text-purple-900 dark:text-purple-200">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                            {holidayOverlap.length === 1
                              ? "1 public holiday"
                              : `${holidayOverlap.length} public holidays`}
                          </span>
                          <span className="font-normal text-muted-foreground">
                            during this leave — click for dates
                          </span>
                          <InfoPopover
                            label="About this notice"
                            align="right"
                          >
                            <p className="font-semibold">Heads up</p>
                            <p className="mt-1">
                              This leave range overlaps one or more
                              gazetted public holidays for your tenant
                              region. Depending on your award profile,
                              you may not need to deduct annual leave
                              for those days, or they may attract a
                              public-holiday penalty rate in the cost
                              calc.
                            </p>
                            <p className="mt-1">
                              Accrual logic isn&rsquo;t enforced yet
                              (deferred to a later slice) — this notice
                              is informational so you can make the call
                              while approving.
                            </p>
                          </InfoPopover>
                        </span>
                      </summary>
                      <ul className="mt-2 space-y-1 text-purple-900 dark:text-purple-200">
                        {holidayOverlap.map((h) => (
                          <li
                            key={`${h.date}-${h.name}`}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="font-medium">{h.name}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {fmtDate(h.date)}
                              {!h.isNational ? (
                                <span className="ml-1 inline-flex items-center rounded-full bg-purple-600/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-purple-900 dark:text-purple-200">
                                  {h.region}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {(canReview || canCancel) && (
                    <div className="mt-3 flex items-center gap-2">
                      {canReview && (
                        <>
                          <form action={approveTimeOffAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" size="sm" variant="outline">
                              Approve
                            </Button>
                          </form>
                          <form action={denyTimeOffAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10"
                            >
                              Deny
                            </Button>
                          </form>
                        </>
                      )}
                      {canCancel && (
                        <form action={cancelOwnTimeOffAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            Cancel
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
