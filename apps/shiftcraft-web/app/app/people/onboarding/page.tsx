import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  forTenant,
  scDepartments,
  scEmployees,
  scEmployeeOnboardingTasks,
  type ScOnboardingStatus,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import { startOnboardingAction } from "./_actions";

export const metadata = { title: "New hire onboarding · ShiftCraft" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ScOnboardingStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  active: "Active",
};

const STATUS_BADGE: Record<ScOnboardingStatus, string> = {
  pending: "bg-amber-500 text-white",
  in_progress: "bg-blue-600 text-white",
  active: "bg-emerald-600 text-white",
};

function startOfThisMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default async function OnboardingHubPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;
  const canManage = isAtLeastManager(membership.role);

  // Counters (small enough to issue three trivial queries).
  const monthStart = startOfThisMonth();
  const [queue, counts, completedThisMonthRows, activeEmployees] =
    await forTenant(tenantId).run(async (tx) => {
      const queueRows = await tx
        .select({
          id: scEmployees.id,
          fullName: scEmployees.fullName,
          email: scEmployees.email,
          mobile: scEmployees.mobile,
          department: scDepartments.name,
          status: scEmployees.onboardingStatus,
          startedAt: scEmployees.onboardingStartedAt,
        })
        .from(scEmployees)
        .leftJoin(
          scDepartments,
          eq(scDepartments.id, scEmployees.departmentId),
        )
        .where(
          inArray(scEmployees.onboardingStatus, ["pending", "in_progress"]),
        )
        .orderBy(desc(scEmployees.onboardingStartedAt), asc(scEmployees.fullName));

      const countRows = await tx
        .select({
          status: scEmployees.onboardingStatus,
          n: count(),
        })
        .from(scEmployees)
        .where(
          inArray(scEmployees.onboardingStatus, ["pending", "in_progress"]),
        )
        .groupBy(scEmployees.onboardingStatus);

      const completedMonth = await tx
        .select({ n: count() })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.onboardingStatus, "active"),
            gte(scEmployees.onboardingCompletedAt, monthStart),
          ),
        );

      const activeRows = canManage
        ? await tx
            .select({
              id: scEmployees.id,
              fullName: scEmployees.fullName,
              email: scEmployees.email,
            })
            .from(scEmployees)
            .where(
              and(
                eq(scEmployees.onboardingStatus, "active"),
                eq(scEmployees.isActive, true),
              ),
            )
            .orderBy(asc(scEmployees.fullName))
        : [];

      return [queueRows, countRows, completedMonth, activeRows];
    });

  const pendingCount = counts.find((c) => c.status === "pending")?.n ?? 0;
  const inProgressCount =
    counts.find((c) => c.status === "in_progress")?.n ?? 0;
  const completedCount = completedThisMonthRows[0]?.n ?? 0;

  // Per-employee task progress for the queue (one round-trip via group-by).
  const progressByEmployee = new Map<
    string,
    { total: number; done: number }
  >();
  if (queue.length > 0) {
    const employeeIds = queue.map((q) => q.id);
    const progressRows = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          employeeId: scEmployeeOnboardingTasks.employeeId,
          status: scEmployeeOnboardingTasks.status,
          n: count(),
        })
        .from(scEmployeeOnboardingTasks)
        .where(inArray(scEmployeeOnboardingTasks.employeeId, employeeIds))
        .groupBy(
          scEmployeeOnboardingTasks.employeeId,
          scEmployeeOnboardingTasks.status,
        ),
    );
    for (const r of progressRows) {
      const cur = progressByEmployee.get(r.employeeId) ?? { total: 0, done: 0 };
      cur.total += Number(r.n);
      if (r.status === "done") cur.done += Number(r.n);
      progressByEmployee.set(r.employeeId, cur);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          New hire onboarding
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track new starters through their pre-shift checklist.
        </p>
      </div>

      {/* ─── Counters ─── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Not started"
          value={pendingCount}
          tone="bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300"
        />
        <Stat
          label="In progress"
          value={inProgressCount}
          tone="bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300"
        />
        <Stat
          label="Completed this month"
          value={completedCount}
          tone="bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
        />
      </div>

      {/* ─── Active queue ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Currently onboarding ({queue.length})
          </h2>
        </div>
        {queue.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            Nobody is being onboarded right now. Start a new onboarding from
            the form below or from{" "}
            <Link
              href="/app/people/team"
              className="underline hover:no-underline"
            >
              Team members
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {queue.map((q) => {
              const progress = progressByEmployee.get(q.id) ?? {
                total: 0,
                done: 0,
              };
              const pct =
                progress.total === 0
                  ? 0
                  : Math.round((progress.done / progress.total) * 100);
              const status = q.status as ScOnboardingStatus;
              return (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={q.fullName}
                      email={q.email ?? q.fullName}
                      image={null}
                      sizeClass="h-9 w-9"
                      textClass="text-xs"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {q.fullName}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {q.email ?? "No email"}
                        {q.department ? ` · ${q.department}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE[status]}`}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                    <div className="w-32">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">
                        {progress.done}/{progress.total} tasks
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/people/onboarding/${q.id}`}>
                        Open checklist
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── Start onboarding (admin only) ─── */}
      {canManage ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">Start onboarding</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Seeds a five-step default checklist for the selected employee.
              They'll show up in the queue above.
            </p>
          </div>
          {activeEmployees.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Every employee on the roster is already onboarded or in the
              queue.{" "}
              <Link
                href="/app/employees/new"
                className="underline hover:no-underline"
              >
                Add a new employee →
              </Link>
            </p>
          ) : (
            <form
              action={startOnboardingAction}
              className="flex flex-wrap items-end gap-3 px-5 py-4"
            >
              <div className="flex-1 space-y-1.5">
                <label
                  htmlFor="onb-employee"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Employee
                </label>
                <select
                  id="onb-employee"
                  name="employeeId"
                  required
                  defaultValue=""
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="" disabled>
                    Choose an employee…
                  </option>
                  {activeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName}
                      {e.email ? ` · ${e.email}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Start onboarding</Button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider">{label}</div>
    </div>
  );
}
