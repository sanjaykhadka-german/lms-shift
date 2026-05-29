import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, between, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  scSkills,
  scTimeOffRequests,
  users,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { addDays, fmtIsoDate, parseIsoDate, startOfWeek } from "~/lib/clock";
import {
  getManagedLocationIds,
  scopeArray,
} from "~/lib/manager-scope";
import {
  generateAssignmentPlan,
  type AutoSchedulerCandidate,
  type AutoSchedulerShift,
  type ApprovedLeaveWindow,
} from "~/lib/auto-scheduler";
import { listEmployeeSkillMap } from "~/lib/skills";
import { Button } from "~/components/ui/button";
import { acceptProposalAction } from "./actions";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Auto-fill schedule · ShiftCraft" };
export const dynamic = "force-dynamic";

function fmtRange(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AutoFillPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; accepted?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const me = await requireUser();
  const tenantId = membership.tenant.id;

  const { week, accepted } = await searchParams;
  const weekStart = startOfWeek(parseIsoDate(week) ?? new Date());
  const weekEnd = addDays(weekStart, 7);
  const weekStartIso = fmtIsoDate(weekStart);

  const scope = await getManagedLocationIds(tenantId, me.id, membership.role);
  const scopeIds = scopeArray(scope);

  // 1. All draft + published shifts this week without an accepted
  //    assignment yet. Includes drafts so a manager who's just done a
  //    duplicate-week can auto-fill before publish.
  const rawShifts = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        requiredSkillId: scShifts.requiredSkillId,
        requiredSkillName: scSkills.name,
      })
      .from(scShifts)
      .leftJoin(scSkills, eq(scSkills.id, scShifts.requiredSkillId))
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          between(scShifts.startsAt, weekStart, weekEnd),
          sql`${scShifts.status} <> 'cancelled'`,
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

  // 2. Candidate pool: every linked employee on this tenant with an
  //    auth user. Pull rate + availability for the generator.
  const employees = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        appUserId: scEmployees.appUserId,
        fullName: scEmployees.fullName,
        hourlyRate: scEmployees.hourlyRate,
        availability: scEmployees.availability,
      })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.isActive, true),
          sql`${scEmployees.appUserId} is not null`,
        ),
      ),
  );

  const skillMap = await listEmployeeSkillMap(
    tenantId,
    employees.map((e) => e.id),
  );

  // 3. Existing assignments for the week — feed the generator so it
  //    respects max-hours and min-rest against what's already in
  //    the schedule.
  const existing = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        userId: scShiftAssignments.userId,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        locationId: scShifts.locationId,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          between(scShifts.startsAt, weekStart, weekEnd),
          sql`${scShifts.status} <> 'cancelled'`,
          sql`${scShiftAssignments.status} in ('accepted','offered')`,
        ),
      ),
  );

  // 4. Approved leave windows for the same employees, filtered to
  //    the week. Cheap range query — typically a handful of rows.
  const leaveRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        userId: scTimeOffRequests.userId,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
      })
      .from(scTimeOffRequests)
      .where(
        and(
          eq(scTimeOffRequests.traceyTenantId, tenantId),
          eq(scTimeOffRequests.status, "approved"),
          gte(scTimeOffRequests.endDate, weekStartIso),
          lt(scTimeOffRequests.startDate, fmtIsoDate(weekEnd)),
        ),
      ),
  );
  const leaveMap = new Map<string, ApprovedLeaveWindow[]>();
  for (const l of leaveRows) {
    const arr = leaveMap.get(l.userId) ?? [];
    arr.push({ startDate: l.startDate, endDate: l.endDate });
    leaveMap.set(l.userId, arr);
  }

  // Names for the proposal display — auth.users.name keyed by id.
  const userIds = Array.from(
    new Set(employees.map((e) => e.appUserId).filter((v): v is string => !!v)),
  );
  const userNames =
    userIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .innerJoin(members, eq(members.userId, users.id))
          .where(
            and(
              eq(members.tenantId, tenantId),
              sql`${users.id} = ANY(${userIds})`,
            ),
          );
  const userById = new Map(
    userNames.map((u) => [u.id, u.name ?? u.email ?? "Unknown"]),
  );

  // 5. Per-location daily wage budgets → a per-(location, day) map the
  //    generator uses to keep each day's projected wage under the cap.
  //    Only locations with a budget set contribute keys; a single daily
  //    figure applies to all 7 days of the visible week.
  const budgetLocations = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scLocations.id,
        dailyWageBudget: scLocations.dailyWageBudget,
      })
      .from(scLocations)
      .where(
        and(
          eq(scLocations.traceyTenantId, tenantId),
          sql`${scLocations.dailyWageBudget} is not null`,
          scopeIds ? sql`${scLocations.id} = ANY(${scopeIds})` : undefined,
        ),
      ),
  );
  const dayBudgets = new Map<string, number>();
  for (const loc of budgetLocations) {
    const budget = Number(loc.dailyWageBudget);
    if (!Number.isFinite(budget)) continue;
    for (let i = 0; i < 7; i += 1) {
      const dayIso = fmtIsoDate(addDays(weekStart, i));
      dayBudgets.set(`${loc.id}|${dayIso}`, budget);
    }
  }

  // Hydrate the generator inputs.
  const generatorShifts: AutoSchedulerShift[] = rawShifts.map((s) => ({
    id: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    requiredSkillId: s.requiredSkillId,
    locationId: s.locationId,
    role: s.role,
  }));
  const generatorCandidates: AutoSchedulerCandidate[] = employees
    .filter((e) => e.appUserId !== null)
    .map((e) => ({
      appUserId: e.appUserId!,
      fullName: e.fullName,
      hourlyRate: e.hourlyRate ? Number(e.hourlyRate) : null,
      availability:
        (e.availability as Record<string, string> | null) ?? null,
      skills: skillMap.get(e.id) ?? new Set<string>(),
    }));

  const result = generateAssignmentPlan(
    generatorShifts,
    generatorCandidates,
    existing,
    leaveMap,
    { dayBudgets },
  );

  // Map shift id → details for the review table.
  const shiftById = new Map(rawShifts.map((s) => [s.id, s]));

  const acceptedCount = Number.parseInt(accepted ?? "", 10);
  const showAcceptedFlash = Number.isFinite(acceptedCount) && accepted !== undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Auto-fill schedule
            <InfoPopover label="About auto-fill">
              <p>
                Greedy generator that proposes assignments for unfilled
                shifts in the week. Respects employee availability,
                approved leave, required skill, the 40h weekly cap, 10h
                minimum rest between shifts, and any per-location daily
                wage budget.
              </p>
              <p className="mt-1">
                Lowest hourly rate wins ties (rate-less candidates
                deprioritised). When a location has a daily wage budget,
                a shift is left unfilled once every affordable candidate
                would push that day&rsquo;s projected wages over the cap.
                Review the proposal table — accept-all creates offered
                assignments via the regular shift-offer flow.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Greedy match for unfilled shifts in the week. Respects
            availability, approved leave, required skills, max weekly
            hours (40h cap), 10h minimum rest, and per-location daily
            wage budgets. Review the proposal below — accept offers
            everyone at once via the regular offered-shift flow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/app/schedule/auto-fill?week=${fmtIsoDate(addDays(weekStart, -7))}`}
            >
              ← Previous week
            </Link>
          </Button>
          <span className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
            Week of {weekStartIso}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/app/schedule/auto-fill?week=${fmtIsoDate(addDays(weekStart, 7))}`}
            >
              Next week →
            </Link>
          </Button>
        </div>
      </div>

      {showAcceptedFlash && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          {acceptedCount === 0
            ? "No new offers — every proposed assignment already existed."
            : `Offered to ${acceptedCount} ${acceptedCount === 1 ? "person" : "people"}. Find them on /app/schedule.`}
        </div>
      )}

      {rawShifts.length === 0 ? (
        <section className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          <p>
            No unfilled shifts this week. Build out the roster on{" "}
            <Link href="/app/schedule" className="underline">
              /app/schedule
            </Link>{" "}
            then come back here.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">
                Proposed assignments ({result.proposal.length})
              </h2>
              {result.proposal.length > 0 && (
                <form action={acceptProposalAction}>
                  <input
                    type="hidden"
                    name="proposal"
                    value={JSON.stringify(
                      result.proposal.map((p) => ({
                        shiftId: p.shiftId,
                        userId: p.userId,
                      })),
                    )}
                  />
                  <Button type="submit" size="sm">
                    Accept all → send offers
                  </Button>
                </form>
              )}
            </div>
            {result.proposal.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nothing could be matched — see the unfilled list below.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {result.proposal.map((p) => {
                  const s = shiftById.get(p.shiftId);
                  if (!s) return null;
                  return (
                    <li
                      key={p.shiftId}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium">
                          {s.role}{" "}
                          {s.requiredSkillName && (
                            <span className="ml-1 inline-flex items-center rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                              {s.requiredSkillName}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {fmtRange(s.startsAt)} → {fmtRange(s.endsAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold">
                          {userById.get(p.userId) ?? "Unknown"}
                        </div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {p.reasoning}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {result.unfilled.length > 0 && (
            <section className="rounded-lg border border-border bg-muted/30 shadow-sm">
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold">
                  Unfilled ({result.unfilled.length})
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  No candidate met every constraint. Expand for the
                  rejection reasons — usually a missing skill, leave
                  overlap, or weekly-hours cap.
                </p>
              </div>
              <ul className="divide-y divide-border">
                {result.unfilled.map((u) => {
                  const s = shiftById.get(u.shiftId);
                  if (!s) return null;
                  return (
                    <li key={u.shiftId} className="px-5 py-3">
                      <details>
                        <summary className="cursor-pointer text-sm font-medium">
                          {s.role} · {fmtRange(s.startsAt)}
                          {s.requiredSkillName && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                              {s.requiredSkillName}
                            </span>
                          )}
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({u.rejections.length} rejection
                            {u.rejections.length === 1 ? "" : "s"})
                          </span>
                        </summary>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {u.rejections.map((r, i) => (
                            <li key={i} className="font-mono">
                              {r}
                            </li>
                          ))}
                          {u.rejections.length === 0 && (
                            <li className="italic">
                              No candidates in the pool at all.
                            </li>
                          )}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
