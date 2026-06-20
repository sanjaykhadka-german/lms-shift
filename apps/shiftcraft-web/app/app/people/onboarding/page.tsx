import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, gte, inArray } from "drizzle-orm";
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
import { BulkStartForm } from "./_bulk-start-form";
import { OnboardingRemindersButton } from "./_reminders-button";
import {
  assignSharedOnboardingTaskAction,
  sendOnboardingEmailAction,
} from "./_actions";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "New hire onboarding · ShiftCraft" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ScOnboardingStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  active: "Active",
};

const STATUS_BADGE: Record<ScOnboardingStatus, string> = {
  pending: "bg-[var(--warn)] text-white",
  in_progress: "bg-[var(--accent-deep)] text-[var(--accent-ink)]",
  active: "bg-[var(--live)] text-white",
};

function startOfThisMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default async function OnboardingHubPage({
  searchParams,
}: {
  searchParams: Promise<{
    started?: string;
    sent?: string;
    reminded?: string;
    assigned?: string;
  }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;
  const canManage = isAtLeastManager(membership.role);

  const { started, sent, reminded, assigned } = await searchParams;
  const startedCount = Number.parseInt(started ?? "", 10);
  const showStartedFlash = Number.isFinite(startedCount) && started !== undefined;
  // R2 — flashes for the reminders + shared-task actions.
  const remindedCount = reminded == null ? null : Number.parseInt(reminded, 10);
  const assignedCount = assigned == null ? null : Number.parseInt(assigned, 10);

  // Counters (small enough to issue three trivial queries).
  const monthStart = startOfThisMonth();
  const [queue, counts, completedThisMonthRows, activeEmployees, departments] =
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
              departmentId: scEmployees.departmentId,
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

      // R2 — department list for the onboard-by-department filter + the
      // bulk shared-task form.
      const departmentRows = canManage
        ? await tx
            .select({ id: scDepartments.id, name: scDepartments.name })
            .from(scDepartments)
            .where(eq(scDepartments.traceyTenantId, tenantId))
            .orderBy(asc(scDepartments.name))
        : [];

      return [queueRows, countRows, completedMonth, activeRows, departmentRows];
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
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          New hire onboarding
          <InfoPopover label="About onboarding">
            <p>
              Track new starters through their pre-shift checklist
              (paperwork, training modules, kit). Completion flips an
              employee&rsquo;s status from <strong>pending</strong> to{" "}
              <strong>active</strong> so they appear in the candidate
              pool.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track new starters through their pre-shift checklist.
        </p>
      </div>

      {showStartedFlash ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          {startedCount > 0
            ? `Started onboarding for ${startedCount} employee${startedCount === 1 ? "" : "s"} — they're in the queue below.`
            : "No onboarding was started."}
        </div>
      ) : null}

      {sent === "1" ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Onboarding email sent — the employee can finish at their Welcome page.
        </div>
      ) : sent === "noemail" ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          That employee has no email on file — add one on their profile before
          sending onboarding.
        </div>
      ) : null}

      {remindedCount != null && Number.isFinite(remindedCount) ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          {remindedCount > 0
            ? `Sent onboarding reminders to ${remindedCount} employee${remindedCount === 1 ? "" : "s"}.`
            : "No one to remind — everyone's onboarding is complete."}
        </div>
      ) : null}

      {assignedCount != null && Number.isFinite(assignedCount) ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          {assignedCount > 0
            ? `Added the task to ${assignedCount} employee${assignedCount === 1 ? "" : "s"}' checklists.`
            : "No one currently onboarding matched — task not added."}
        </div>
      ) : null}

      {/* ─── Counters ─── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Not started"
          value={pendingCount}
          tone="bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] border-[color-mix(in_srgb,var(--warn)_40%,transparent)] text-[var(--warn)]"
        />
        <Stat
          label="In progress"
          value={inProgressCount}
          tone="bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] border-[color-mix(in_srgb,var(--accent-deep)_40%,transparent)] text-[var(--accent-deep)]"
        />
        <Stat
          label="Completed this month"
          value={completedCount}
          tone="bg-[color-mix(in_srgb,var(--live)_12%,transparent)] border-[color-mix(in_srgb,var(--live)_40%,transparent)] text-[var(--live)]"
        />
      </div>

      {/* ─── Active queue ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Currently onboarding ({queue.length})
          </h2>
          {/* R2 — completion reminders: nudge everyone still onboarding. */}
          {canManage && queue.length > 0 ? <OnboardingRemindersButton /> : null}
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
                    {canManage ? (
                      <form action={sendOnboardingEmailAction}>
                        <input type="hidden" name="employeeId" value={q.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          disabled={!q.email}
                          title={
                            q.email
                              ? "Email this employee a link to complete onboarding"
                              : "Add an email to their profile first"
                          }
                        >
                          Send onboarding
                        </Button>
                      </form>
                    ) : null}
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
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-5 py-3">
            <div>
              <h2 className="text-base font-semibold">Start onboarding</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Seeds your onboarding checklist for each selected employee —
                tick one, several, or all (handy right after a bulk import).
                They&rsquo;ll show up in the queue above.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/app/people/onboarding/checklist">
                Customise checklist
              </Link>
            </Button>
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
            <BulkStartForm
              employees={activeEmployees}
              departments={departments}
            />
          )}
        </section>
      ) : null}

      {/* ─── R2 — assign a shared task to everyone onboarding (admin only) ─── */}
      {canManage && queue.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">Assign a shared task</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Add one task (e.g. &ldquo;Read the Dispatch safety manual&rdquo;)
              to everyone currently onboarding — optionally just one department.
            </p>
          </div>
          <form
            action={assignSharedOnboardingTaskAction}
            className="space-y-3 px-5 py-4"
          >
            <div className="space-y-1.5">
              <label
                htmlFor="shared-title"
                className="text-xs font-medium text-muted-foreground"
              >
                Task title
              </label>
              <input
                id="shared-title"
                name="title"
                required
                maxLength={200}
                placeholder="e.g. Read the Dispatch safety manual"
                className="h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="shared-desc"
                className="text-xs font-medium text-muted-foreground"
              >
                Description (optional)
              </label>
              <textarea
                id="shared-desc"
                name="description"
                rows={2}
                maxLength={2000}
                className="w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Department
                <select
                  name="departmentId"
                  defaultValue=""
                  className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                >
                  <option value="">Everyone onboarding</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  name="required"
                  defaultChecked
                  className="h-4 w-4 rounded border-border"
                />
                Required
              </label>
              <Button type="submit" size="sm" className="ml-auto">
                Add task
              </Button>
            </div>
          </form>
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
